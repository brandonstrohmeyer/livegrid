import React, { useEffect, useState, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import version from './version.js'
import { Sidebar, Menu, MenuItem } from 'react-pro-sidebar'
import { MdFullscreen, MdFullscreenExit, MdSettings, MdBuild, MdPlayArrow, MdWarning, MdLink, MdHelpOutline, MdNotificationsActive, MdNotificationsPaused, MdMenu, MdClose } from 'react-icons/md'
import { GiFullMotorcycleHelmet } from 'react-icons/gi'
import { FaInstagram } from 'react-icons/fa'
import { FaEnvelope } from 'react-icons/fa'
import { FaDiscord } from 'react-icons/fa'
import { httpsCallable } from 'firebase/functions'
import { useAuth } from './contexts/AuthContext'
import { useSyncedPreference } from './contexts/PreferencesContext'
import { getViewport, onViewportChange } from 'viewportify'
import { functions } from './firebaseClient'
import FirebaseAuthUI from './components/FirebaseAuthUI'
import {
  obtainPushToken,
  revokePushToken,
  registerTokenWithServer,
  unregisterTokenWithServer,
  sendServerPush
} from './pushNotifications'
import { addMinutes } from './scheduleUtils.js'
import { parseCsvSchedule, detectParserId, SCHEDULE_PARSERS, DEFAULT_SCHEDULE_PARSER_ID } from './schedule/parsers/registry.js'
import { log } from './logging.js'
import { reportEventSelected, reportVisitorOpened, startVisitorHeartbeat } from './telemetry.js'

const DEFAULT_STALE_THRESHOLD_MINUTES = 5
const createEmptySchedule = () => ({
  runGroups: ['All'],
  sessions: [],
  activities: [],
  days: [],
  warnings: []
})

const SHEETS_FUNCTION_NAME = 'sheetsApi'
const rawFunctionsBaseUrl = (import.meta.env.VITE_FUNCTIONS_BASE_URL || '').trim()
const useFunctionsEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
const emulatorProjectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
const emulatorBaseUrl = emulatorProjectId ? `http://localhost:5001/${emulatorProjectId}/us-central1` : ''
const resolvedFunctionsBaseUrl = rawFunctionsBaseUrl || (useFunctionsEmulator ? emulatorBaseUrl : '')
const functionsBaseUrl = resolvedFunctionsBaseUrl ? resolvedFunctionsBaseUrl.replace(/\/+$/, '') : ''

const functionEndpoint = (proxyPath, functionName) => {
  if (!functionsBaseUrl) {
    return `/api/${proxyPath}`
  }

  if (functionsBaseUrl.endsWith(`/${functionName}`)) {
    return functionsBaseUrl
  }

  return `${functionsBaseUrl}/${functionName}`
}

const cachedEventsEndpoint = functionEndpoint('cached-events', 'cachedEvents')

const sheetsEndpoint = (path) => {
  if (!functionsBaseUrl) {
    return `/api/${path}`
  }

  if (functionsBaseUrl.endsWith(`/${SHEETS_FUNCTION_NAME}`)) {
    return `${functionsBaseUrl}/${path}`
  }

  return `${functionsBaseUrl}/${SHEETS_FUNCTION_NAME}/${path}`
}

async function callSheetsApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(sheetsEndpoint(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Sheets API request failed (${response.status}): ${errorText}`)
  }
  const payload = await response.json().catch(() => ({}))
  if (path.includes('/tabs')) {
    log.debug('sheets_ui.tabs_response', {
      spreadsheetId: payload?.spreadsheetId ?? null,
      tabCount: Array.isArray(payload?.tabs) ? payload.tabs.length : 0
    })
  }
  return payload
}

function csvEscape(value) {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function rowsToCsv(headers, rows) {
  const lines = []
  if (Array.isArray(headers) && headers.length) {
    lines.push(headers.map(csvEscape).join(','))
  }
  if (Array.isArray(rows)) {
    rows.forEach(row => {
      lines.push((Array.isArray(row) ? row : []).map(csvEscape).join(','))
    })
  }
  return lines.join('\n')
}

function scoreTabTitle(title) {
  if (!title) return 0
  const value = title.toLowerCase()
  let score = 0
  if (value.includes('schedule')) score += 6
  if (value.includes('run')) score += 3
  if (value.includes('grid')) score += 3
  if (value.includes('session')) score += 2
  if (value.includes('hpde')) score += 2
  if (value.includes('tt')) score += 2
  if (value.includes('notes') || value.includes('info')) score -= 2
  if (value.includes('archive') || value.includes('old')) score -= 3
  return score
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const INACTIVITY_RESET_MS = 24 * 60 * 60 * 1000
const LAST_SEEN_STORAGE_KEY = 'livegridLastSeenAt'

function readLastSeenAt() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function writeLastSeenAt(timestamp) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, String(timestamp))
  } catch (err) {
    log.warn('auto_reset.persist_failed', undefined, err)
  }
}

function normalizeDayLabel(value) {
  if (!value) return null
  const text = value
    .toString()
    .replace(/\u00A0|\u202F/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (/\bmonday\b|\bmon\b/.test(text)) return 'Monday'
  if (/\btuesday\b|\btue\b|\btues\b/.test(text)) return 'Tuesday'
  if (/\bwednesday\b|\bwed\b/.test(text)) return 'Wednesday'
  if (/\bthursday\b|\bthu\b|\bthur\b|\bthurs\b/.test(text)) return 'Thursday'
  if (/\bfriday\b|\bfri\b/.test(text)) return 'Friday'
  if (/\bsaturday\b|\bsat\b/.test(text)) return 'Saturday'
  if (/\bsunday\b|\bsun\b/.test(text)) return 'Sunday'
  return null
}

function buildDayTabs(tabs = []) {
  if (!Array.isArray(tabs)) return []
  const seen = new Set()
  const dayTabs = []
  tabs.forEach(tab => {
    const day = normalizeDayLabel(tab?.title || '')
    if (!day || seen.has(day)) return
    dayTabs.push({ day, sheetId: tab.sheetId, title: tab.title })
    seen.add(day)
  })
  dayTabs.sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day))
  return dayTabs
}

function pickBestTab(tabs = []) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null
  const scored = tabs.map(tab => ({
    ...tab,
    score: scoreTabTitle(tab.title)
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.score > 0 ? scored[0] : tabs[0]
}
function useBreakpoint(maxWidth = 900) {
  const getInitial = () => {
    if (typeof window === 'undefined') return false
    return window.innerWidth <= maxWidth
  }

  const [isBelowBreakpoint, setIsBelowBreakpoint] = useState(getInitial)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleResize = () => setIsBelowBreakpoint(window.innerWidth <= maxWidth)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [maxWidth])

  return isBelowBreakpoint
}

function getDateWithOffsets(date, clockOffset = 0, dayOffset = 0) {
  if (!date) return null
  const offsetMs = clockOffset * 60000 + dayOffset * 86400000
  return new Date(date.getTime() + offsetMs)
}

// ============================================================================
// ACTIVITY FILTERING - Find relevant meetings/classroom items
// ============================================================================
function arraysEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function filterRelevantActivities(activities, selectedDay, selectedGroups) {
  if (selectedGroups.includes('All') || selectedGroups.length === 0) return []
  if (!activities || activities.length === 0) return []

  return activities.filter(activity => {
    if (!activity || !activity.start) return false
    if (selectedDay && activity.day && activity.day !== selectedDay) return false
    const related = Array.isArray(activity.relatedRunGroupIds) ? activity.relatedRunGroupIds : []
    return related.some(group => selectedGroups.includes(group))
  })
}

// ============================================================================
// SESSION QUERIES - Find current and upcoming sessions
// ============================================================================

/**
 * Find the currently active session
 */
function findCurrentSession(sessions, nowWithOffset) {
  return sessions.find(session => {
    if (!session.start) return false
    const end = session.end || addMinutes(session.start, session.duration || 20)
    return nowWithOffset >= session.start && nowWithOffset < end
  }) || null
}

/**
 * Check if a session matches a selected group
 */
function sessionMatchesGroup(session, group) {
  if (!session || !group) return false
  if (group === 'All') return true
  const runGroupIds = Array.isArray(session.runGroupIds) ? session.runGroupIds : []
  return runGroupIds.includes(group)
}

/**
 * Find the next upcoming session for selected groups
 */
function findNextSession(sessions, selectedGroups, nowWithOffset) {
  // If 'All' is selected, return next session regardless of group
  if (selectedGroups.includes('All')) {
    return sessions.find(session => 
      session.start && session.start > nowWithOffset
    ) || null
  }
  
  // Filter by selected groups
  const filteredSessions = sessions.filter(session => 
    selectedGroups.some(group => sessionMatchesGroup(session, group))
  )
  
  return filteredSessions.find(session => 
    session.start && session.start > nowWithOffset
  ) || null
}

/**
 * Find next session for each selected group
 * Returns object mapping group name to next session
 */
function findNextSessionsPerGroup(sessions, selectedGroups, nowWithOffset) {
  if (selectedGroups.includes('All')) {
    const nextSession = findNextSession(sessions, ['All'], nowWithOffset)
    // Use session name as key instead of 'All' to avoid redundancy
    return nextSession ? { [nextSession.session]: nextSession } : {}
  }
  
  const result = {}
  selectedGroups.forEach(group => {
    const next = findNextSession(sessions, [group], nowWithOffset)
    if (next) result[group] = next
  })
  
  return result
}

// ============================================================================
// FORMATTING UTILITIES - Display helpers
// ============================================================================

/**
 * Format time with small superscript AM/PM
 */
function formatTimeWithAmPm(date) {
  if (!date) return ''
  const hours = date.getHours() % 12 || 12
  const mins = String(date.getMinutes()).padStart(2, '0')
  const ampm = date.getHours() >= 12 ? 'PM' : 'AM'
  return `${hours}:${mins} ${ampm}`
}

/**
 * Format a remaining duration in ms as a short label like "now", "5m", or "1h 10m".
 * Expects a positive milliseconds value; callers should clamp at 0.
 */
function formatTimeUntil(milliseconds, session, nowWithOffset) {
  if (!session || !session.start) return ''

  const end = session.end || addMinutes(session.start, session.duration || 20)
  if (nowWithOffset >= session.start && nowWithOffset < end) {
    return 'now'
  }
  if (milliseconds <= 0) return '0m'

  const totalMinutes = Math.ceil(milliseconds / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function getMobileSessionEndStatus(session, nowWithOffset) {
  if (!session || !session.start || !nowWithOffset) return null
  const end = session.end || addMinutes(session.start, session.duration || 20)
  const diffMs = end.getTime() - nowWithOffset.getTime()
  if (diffMs <= 0) return null
  if (diffMs < 60000) return { text: 'Ending now', showPrefix: false }
  const totalMinutes = Math.ceil(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return {
    text: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
    showPrefix: true
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function App() {
  // Check URL parameters for demo mode BEFORE any state initialization
  const urlParams = new URLSearchParams(window.location.search)
  const isDemoMode = urlParams.get('demo') === 'true' || urlParams.get('demo') === '1'
  
  // Calculate demo offsets once if needed
  const getDemoOffsets = () => {
    if (!isDemoMode) return { dayOffset: 0, clockOffset: 0 }
    
    const now = new Date()
    const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7
    const target = new Date(now)
    target.setDate(target.getDate() + daysUntilSaturday)
    target.setHours(10, 30, 0, 0)
    
    const nowDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const targetDayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())
    const dayDiff = Math.round((targetDayStart - nowDayStart) / 86400000)
    const nowTimeMs = now.getTime() - nowDayStart.getTime()
    const targetTimeMs = target.getTime() - targetDayStart.getTime()
    const clockMinutes = Math.round((targetTimeMs - nowTimeMs) / 60000)
    
    return { dayOffset: dayDiff, clockOffset: clockMinutes }
  }
  
  const demoOffsets = getDemoOffsets()
  const { user, loading: authLoading, error: authError, signOut: signOutUser } = useAuth()
  
  // State management - initialize with demo values if URL param is set
  const [scheduleData, setScheduleData] = useState(createEmptySchedule)
  const [clockOffset, setClockOffset] = useState(demoOffsets.clockOffset)
  const [dayOffset, setDayOffset] = useState(demoOffsets.dayOffset)
  const [clockOffsetInput, setClockOffsetInput] = useState(String(demoOffsets.clockOffset))
  const [dayOffsetInput, setDayOffsetInput] = useState(String(demoOffsets.dayOffset))
  const [now, setNow] = useState(new Date())
  const [selectedGroups, setSelectedGroups, selectedGroupsLoading] = useSyncedPreference(
    'selectedGroups',
    () => (isDemoMode ? ['HPDE 1', 'TT Omega'] : ['All'])
  )
  const [selectedDay, setSelectedDay] = useSyncedPreference('selectedDay', () => (isDemoMode ? 'Saturday' : null))
  const [selectedCsvFile, setSelectedCsvFile] = useSyncedPreference(
    'selectedCsvFile',
    () => (isDemoMode ? '2026 New Year, New Gear - Schedule.csv' : '')
  )
  const lastSeenRef = useRef(null)
  const [scheduleParserId, setScheduleParserId] = useSyncedPreference(
    'scheduleParserId',
    () => DEFAULT_SCHEDULE_PARSER_ID
  )
  const [customUrl, setCustomUrl] = useSyncedPreference('customUrl', () => '')
  const [autoScrollEnabled, setAutoScrollEnabled] = useSyncedPreference('autoScrollEnabled', () => true)
  const [staleThresholdMinutes, setStaleThresholdMinutes] = useSyncedPreference(
    'staleThresholdMinutes',
    () => DEFAULT_STALE_THRESHOLD_MINUTES
  )
  const [lastFetch, setLastFetch] = useState(null)
  const [debugMode, setDebugMode] = useState(isDemoMode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [showHelpSection, setShowHelpSection] = useState(false)
  const [showAccountSection, setShowAccountSection] = useState(false)
  const [showNotificationsSection, setShowNotificationsSection] = useState(false)
  const [accountPanelMaxHeight, setAccountPanelMaxHeight] = useState(null)
  const [runGroupsExpanded, setRunGroupsExpanded] = useState(false)
  const [mobileCurrentExpanded, setMobileCurrentExpanded] = useState(false)
  const [optionsExpanded, setOptionsExpanded] = useState(() => (isDemoMode ? false : !customUrl))
  const [sheetName, setSheetName] = useState('')
  const [sheetDayTabs, setSheetDayTabs] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('online') // 'online', 'offline', 'error'
  const [lastSuccessfulFetch, setLastSuccessfulFetch] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [rssEvents, setRssEvents] = useState([])
  const [rssLoading, setRssLoading] = useState(false)
  const [rssError, setRssError] = useState(null)
  const [hodEvents, setHodEvents] = useState([])
  const [hodLoading, setHodLoading] = useState(false)
  const [hodError, setHodError] = useState(null)
  const [selectedRssEventId, setSelectedRssEventId] = useState('')
  const [selectedHodEventId, setSelectedHodEventId] = useState('')
  const eventsFetchStartedRef = useRef(false)
  const sheetSelectionRef = useRef({ url: '', spreadsheetId: '', sheetId: null, sheetTitle: '', spreadsheetTitle: '' })
  const [forceShowStaleBanner, setForceShowStaleBanner] = useState(false)
  const upcomingNotificationTrackerRef = useRef(new Map())
  const pushSyncPromiseRef = useRef(null)
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useSyncedPreference('notificationLeadMinutes', () => 15)
  const supportsNotifications = typeof window !== 'undefined' && 'Notification' in window
  const supportsServiceWorkers = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''
  const isIOS = typeof navigator !== 'undefined' && (
    /iP(ad|hone|od)/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
  const isMobileSafari = isIOS && /Safari/.test(userAgent) && !/(Chrome|CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave|Vivaldi)/.test(userAgent)
  const isStandalone = typeof window !== 'undefined' && (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone)
  )
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (!supportsNotifications) return 'unsupported'
    return Notification.permission
  })
  const [notificationPrompting, setNotificationPrompting] = useState(false)
  const [notificationTesting, setNotificationTesting] = useState(false)
  const [mockTestMinutesInput, setMockTestMinutesInput] = useState('2')
  const [mockTestGroupInput, setMockTestGroupInput] = useState('Mock Test')
  const [notificationStatus, setNotificationStatus] = useState(null)
  const [schedulerDebugInfo, setSchedulerDebugInfo] = useState(() => ({
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastSyncError: null,
    eventId: null,
    scheduledCount: 0,
    nextScheduled: null
  }))
  const [serviceWorkerRegistrationState, setServiceWorkerRegistrationState] = useState(() => {
    if (!supportsServiceWorkers) return 'unsupported'
    return 'checking'
  })
  const [pushToken, setPushToken] = useState(null)
  const [pushSyncState, setPushSyncState] = useState('idle')
  const [pushSetupError, setPushSetupError] = useState(null)
  const [pushPaused, setPushPaused] = useState(false)
  const [notificationLeadInput, setNotificationLeadInput] = useState(String(notificationLeadMinutes))
  const [authNotice, setAuthNotice] = useState(null)
  const authNoticeTimerRef = useRef(null)
  const resolvedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      log.warn('notifications.timezone_resolve_failed', undefined, error)
      return 'UTC'
    }
  }, [])

  useEffect(() => {
    setNotificationLeadInput(String(notificationLeadMinutes))
  }, [notificationLeadMinutes])

  useEffect(() => {
    setClockOffsetInput(String(clockOffset))
  }, [clockOffset])

  useEffect(() => {
    setDayOffsetInput(String(dayOffset))
  }, [dayOffset])

  useEffect(() => {
    if (authLoading) return undefined

    reportVisitorOpened({
      authState: user ? 'signed_in' : 'anonymous'
    })

    return startVisitorHeartbeat(() => ({
      authState: user ? 'signed_in' : 'anonymous'
    }))
  }, [authLoading, user])

  useEffect(() => {
    return () => {
      if (authNoticeTimerRef.current) {
        clearTimeout(authNoticeTimerRef.current)
      }
    }
  }, [])
  const appOrigin = useMemo(() => {
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin
    }
    return 'https://livegrid.app'
  }, [])
  const isLocalDemoScheduleActive = Boolean(debugMode && !customUrl && selectedCsvFile)
  const eventId = useMemo(() => {
    if (customUrl) {
      const sheetMatch = customUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
      const gidMatch = customUrl.match(/[#&]gid=(\d+)/)
      if (sheetMatch) {
        return `sheet:${sheetMatch[1]}${gidMatch ? `:gid:${gidMatch[1]}` : ''}`
      }
      return `sheet-url:${customUrl}`
    }
    if (isLocalDemoScheduleActive) return `file:${selectedCsvFile}`
    return null
  }, [customUrl, isLocalDemoScheduleActive, selectedCsvFile])
  const syncScheduledNotificationsFn = useMemo(() => (
    functions ? httpsCallable(functions, 'syncScheduledNotifications') : null
  ), [functions])
  const scheduleSyncSignatureRef = useRef(null)

  useEffect(() => {
    if (!sidebarOpen) {
      setShowHelpSection(false)
      setShowAccountSection(false)
      setShowNotificationsSection(false)
    }
  }, [sidebarOpen])

  const staleThresholdMs = useMemo(() => Math.max(1, staleThresholdMinutes) * 60000, [staleThresholdMinutes])
  const staleThresholdLabel = useMemo(() => (
    staleThresholdMinutes === 1 ? '1 minute' : `${staleThresholdMinutes} minutes`
  ), [staleThresholdMinutes])
  const combinedEvents = useMemo(() => ([
    ...rssEvents.map(ev => ({ ...ev, source: 'nasa', label: `[NASA-SE] ${ev.title}` })),
    ...hodEvents.map(ev => ({ ...ev, source: 'hod', label: `[HOD-MA] ${ev.title}` }))
  ]), [rssEvents, hodEvents])
  const selectedEventId = useMemo(
    () => selectedRssEventId || selectedHodEventId || '',
    [selectedRssEventId, selectedHodEventId]
  )

  const hasActiveSchedule = useMemo(() => {
    if (customUrl) return true
    if (isLocalDemoScheduleActive) return true
    return false
  }, [customUrl, isLocalDemoScheduleActive])

  const scheduleParser = useMemo(() => (
    SCHEDULE_PARSERS.find(parser => parser.id === scheduleParserId) || SCHEDULE_PARSERS[0] || null
  ), [scheduleParserId])

  useEffect(() => {
    if (!scheduleParser) return
    if (scheduleParserId !== scheduleParser.id) {
      setScheduleParserId(scheduleParser.id)
    }
  }, [scheduleParser, scheduleParserId, setScheduleParserId])

  const isDataStale = useMemo(() => {
    if (!hasActiveSchedule) return false
    if (!lastSuccessfulFetch) return false
    return now.getTime() - lastSuccessfulFetch.getTime() > staleThresholdMs
  }, [hasActiveSchedule, lastSuccessfulFetch, now, staleThresholdMs])

  const dayTabSelectionKey = useMemo(() => (
    customUrl && sheetDayTabs.length > 0 ? (selectedDay || '') : ''
  ), [customUrl, sheetDayTabs, selectedDay])

  const availableDays = useMemo(() => {
    if (sheetDayTabs.length > 0) {
      return sheetDayTabs.map(entry => entry.day)
    }
    return scheduleData.days || []
  }, [sheetDayTabs, scheduleData])

  useEffect(() => {
    if (customUrl) {
      log.debug('sheets_ui.available_days', { availableDays, sheetDayTabs })
    }
  }, [customUrl, availableDays, sheetDayTabs])
  const sessions = useMemo(() => scheduleData.sessions || [], [scheduleData])
  const activities = useMemo(() => scheduleData.activities || [], [scheduleData])
  const isEmptySchedule = useMemo(() => {
    const days = Array.isArray(scheduleData.days) ? scheduleData.days : []
    const runGroups = Array.isArray(scheduleData.runGroups) ? scheduleData.runGroups : []
    const isDefaultRunGroups = runGroups.length === 1 && runGroups[0] === 'All'
    return sessions.length === 0 && activities.length === 0 && days.length === 0 && isDefaultRunGroups
  }, [scheduleData, sessions, activities])
  const groups = useMemo(() => {
    const baseGroups = scheduleData.runGroups && scheduleData.runGroups.length > 0
      ? scheduleData.runGroups
      : ['All']
    if (!selectedDay || !sessions.length) return baseGroups

    const dayGroups = new Set()
    let hasDaySessions = false
    sessions.forEach(session => {
      if (!session || !session.day || session.day !== selectedDay) return
      hasDaySessions = true
      const sessionGroups = Array.isArray(session.runGroupIds) ? session.runGroupIds : []
      sessionGroups.forEach(group => dayGroups.add(group))
    })

    if (!hasDaySessions || dayGroups.size === 0) return baseGroups

    const filtered = baseGroups.filter(group => group === 'All' || dayGroups.has(group))
    return filtered.includes('All') ? filtered : ['All', ...filtered]
  }, [scheduleData, sessions, selectedDay])
  const rows = useMemo(() => {
    if (!sessions.length) return []
    if (selectedDay && availableDays.includes(selectedDay)) {
      return sessions.filter(session => session.day === selectedDay)
    }
    if (availableDays.length > 0) {
      return sessions.filter(session => session.day === availableDays[0])
    }
    return sessions
  }, [sessions, selectedDay, availableDays])

  useEffect(() => {
    if (selectedGroupsLoading) return
    if (isEmptySchedule) return
    if (!groups || groups.length === 0) return
    setSelectedGroups(prev => {
      const safePrev = Array.isArray(prev) ? prev : []
      const filtered = safePrev.filter(group => groups.includes(group))
      const next = filtered.length > 0 ? filtered : ['All']
      if (next.includes('All') && next.length > 1) return ['All']
      return arraysEqual(safePrev, next) ? prev : next
    })
  }, [groups, isEmptySchedule, selectedGroupsLoading, setSelectedGroups])

  const isMobile = useBreakpoint(900)
  const [hasToolbarInset, setHasToolbarInset] = useState(false)
  const [viewportHeightPx, setViewportHeightPx] = useState(null)
  const viewportWidthRef = useRef(null)
  const accountPanelRef = useRef(null)
  const helpSectionRef = useRef(null)
  const viewportHeightStyle = viewportHeightPx ? `${viewportHeightPx}px` : 'var(--vp-dvh, var(--vp-height, 100dvh))'
  const viewportMinHeightStyle = viewportHeightPx ? `${viewportHeightPx}px` : 'var(--vp-dvh, var(--vp-height, 100vh))'
  const safeAreaPaddingExpr = 'var(--vp-safe-bottom, env(safe-area-inset-bottom, 0px))'

  useEffect(() => {
    if (!isMobile && mobileCurrentExpanded) {
      setMobileCurrentExpanded(false)
    }
  }, [isMobile, mobileCurrentExpanded])

  useEffect(() => {
    const updateInset = (info) => {
      if (!info) {
        setHasToolbarInset(false)
        setViewportHeightPx(null)
        return
      }
      const lvh = Number.isFinite(info.lvh) ? info.lvh : info.height
      const dvh = Number.isFinite(info.dvh) ? info.dvh : info.height
      const height = Number.isFinite(info.dvh) ? info.dvh : info.height
      const width = Number.isFinite(info.width) ? info.width : null
      setHasToolbarInset(lvh - dvh > 1)
      if (Number.isFinite(width) && width !== viewportWidthRef.current) {
        viewportWidthRef.current = width
        setViewportHeightPx(Number.isFinite(height) ? Math.round(height) : null)
        return
      }
      setViewportHeightPx(prev => {
        const next = Number.isFinite(height) ? Math.round(height) : null
        if (!next) return null
        if (!prev) return next
        if (isMobile) {
          return Math.min(prev, next)
        }
        return next
      })
    }

    updateInset(getViewport())
    const unsubscribe = onViewportChange(updateInset)

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [isMobile])

  const measureAccountPanelHeight = useCallback(() => {
    const panel = accountPanelRef.current
    const help = helpSectionRef.current
    if (!panel || !help) return
    const panelRect = panel.getBoundingClientRect()
    const helpRect = help.getBoundingClientRect()
    const available = Math.max(0, Math.floor(helpRect.top - panelRect.top - 12))
    setAccountPanelMaxHeight(prev => (prev === available ? prev : available))
  }, [])

  useLayoutEffect(() => {
    if (!sidebarOpen || !showAccountSection) {
      setAccountPanelMaxHeight(null)
      return
    }
    const raf = requestAnimationFrame(() => {
      measureAccountPanelHeight()
    })
    return () => cancelAnimationFrame(raf)
  }, [
    sidebarOpen,
    showAccountSection,
    showHelpSection,
    showNotificationsSection,
    viewportHeightPx,
    isMobile,
    measureAccountPanelHeight
  ])

  // Refs for scrolling
  const listRef = useRef(null)
  const itemRefs = useRef({})
  
  // Clock updates
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  
  // Monitor network connection status
  useEffect(() => {
    const handleOnline = () => {
      if (!hasActiveSchedule) {
        setConnectionStatus('idle')
        setFetchError(null)
        return
      }

      setConnectionStatus('online')
      setFetchError(null)
      // Retry fetch immediately when connection returns
      fetchSchedule()
    }
    const handleOffline = () => {
      setConnectionStatus('offline')
      setFetchError('No internet connection')
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Set initial status
    if (!navigator.onLine) {
      setConnectionStatus('offline')
    } else {
      setConnectionStatus(hasActiveSchedule ? 'online' : 'idle')
    }
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [hasActiveSchedule])
  
  // Reset sheet name when URL changes
  useEffect(() => {
    setSheetName('')
  }, [customUrl])

  // Keep selected RSS event in sync with the current custom URL
  useEffect(() => {
    if (!rssEvents.length || !customUrl) {
      setSelectedRssEventId('')
      return
    }
    const match = rssEvents.find(ev => ev.sheetUrl === customUrl)
    setSelectedRssEventId(match ? match.id : '')
  }, [rssEvents, customUrl])

  useEffect(() => {
    if (!hodEvents.length || !customUrl) {
      setSelectedHodEventId('')
      return
    }
    const match = hodEvents.find(ev => ev.sheetUrl === customUrl)
    setSelectedHodEventId(match ? match.id : '')
  }, [hodEvents, customUrl])

  useEffect(() => {
    if (!supportsNotifications) return undefined
    if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return undefined
    let permissionStatus
    let cancelled = false
    const handlePermissionChange = () => {
      if (!cancelled && permissionStatus) {
        setNotificationPermission(permissionStatus.state)
      }
    }
    navigator.permissions.query({ name: 'notifications' }).then(status => {
      if (cancelled) return
      permissionStatus = status
      setNotificationPermission(status.state)
      if (status.addEventListener) {
        status.addEventListener('change', handlePermissionChange)
      } else {
        status.onchange = handlePermissionChange
      }
    }).catch(() => {})
    return () => {
      cancelled = true
      if (permissionStatus) {
        if (permissionStatus.removeEventListener) {
          permissionStatus.removeEventListener('change', handlePermissionChange)
        } else if (permissionStatus.onchange === handlePermissionChange) {
          permissionStatus.onchange = null
        }
      }
    }
  }, [supportsNotifications])

  useEffect(() => {
    let cancelled = false
    if (!supportsServiceWorkers || !navigator.serviceWorker) {
      setServiceWorkerRegistrationState(supportsServiceWorkers ? 'unavailable' : 'unsupported')
      return () => { cancelled = true }
    }
    Promise.race([
      navigator.serviceWorker.getRegistration(),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]).then(reg => {
      if (cancelled) return
      if (reg) {
        setServiceWorkerRegistrationState('registered')
      } else {
        setServiceWorkerRegistrationState('not-registered')
      }
    }).catch(() => {
      if (!cancelled) setServiceWorkerRegistrationState('error')
    })
    return () => { cancelled = true }
  }, [supportsServiceWorkers])
  
  // Preferences sync is handled via context

  // Lazy-load event lists when options panel is opened
  useEffect(() => {
    if (!optionsExpanded) return

    if (!eventsFetchStartedRef.current) {
      eventsFetchStartedRef.current = true
      fetchCachedEvents()
    }
  }, [optionsExpanded])
  
  // Toggle body class for debug mode overflow handling and disable auto-scroll
  useEffect(() => {
    if (showDebugPanel) {
      document.body.classList.add('debug-mode')
      setAutoScrollEnabled(false) // Disable auto-scroll when debug panel opens
    } else {
      document.body.classList.remove('debug-mode')
    }
    return () => document.body.classList.remove('debug-mode')
  }, [showDebugPanel])
  
  // Computed effective time with debug offsets
  const nowWithOffset = useMemo(() => {
    return new Date(now.getTime() + clockOffset * 60000 + dayOffset * 86400000)
  }, [now, clockOffset, dayOffset])

  const lastFetchAdjusted = useMemo(() => {
    if (!hasActiveSchedule) return null
    if (!lastSuccessfulFetch) return null
    return getDateWithOffsets(lastSuccessfulFetch, clockOffset, dayOffset)
  }, [hasActiveSchedule, lastSuccessfulFetch, clockOffset, dayOffset])

  const lastFetchTimeDisplay = lastFetchAdjusted ? lastFetchAdjusted.toLocaleTimeString() : 'Never'
  const lastFetchDateTimeDisplay = lastFetchAdjusted ? lastFetchAdjusted.toLocaleString() : 'Never'

  const getAuthToken = useCallback(async () => {
    if (!user || typeof user.getIdToken !== 'function') return null
    try {
      return await user.getIdToken()
    } catch (error) {
      log.error('notifications.auth_token_fetch_failed', undefined, error)
      return null
    }
  }, [user])

  const showTimedNotification = useCallback(payload => {
    const id = `${Date.now()}-${Math.random()}`
    setNotificationStatus({ ...payload, id, fading: false })
    setTimeout(() => {
      setNotificationStatus(prev => (prev && prev.id === id ? { ...prev, fading: true } : prev))
    }, 3000)
    setTimeout(() => {
      setNotificationStatus(prev => (prev && prev.id === id ? null : prev))
    }, 4000)
  }, [setNotificationStatus])
  const showAuthNotice = useCallback((message) => {
    setAuthNotice(message)
    if (authNoticeTimerRef.current) {
      clearTimeout(authNoticeTimerRef.current)
    }
    authNoticeTimerRef.current = setTimeout(() => {
      setAuthNotice(null)
    }, 4000)
  }, [])
  const resetActiveSheet = useCallback(() => {
    setCustomUrl('')
    setSheetName('')
    setSelectedRssEventId('')
  }, [setCustomUrl, setSelectedRssEventId, setSheetName])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const markSeen = () => {
      const now = Date.now()
      lastSeenRef.current = now
      writeLastSeenAt(now)
    }

    const checkAndReset = () => {
      if (!customUrl) return
      const lastSeen = lastSeenRef.current
      if (typeof lastSeen !== 'number') return
      if (Date.now() - lastSeen < INACTIVITY_RESET_MS) return
      log.info('auto_reset.clearing_active_sheet', {
        lastSeen: new Date(lastSeen).toISOString()
      })
      resetActiveSheet()
    }

    if (lastSeenRef.current == null) {
      const stored = readLastSeenAt()
      if (typeof stored === 'number') {
        lastSeenRef.current = stored
      } else {
        markSeen()
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      checkAndReset()
      markSeen()
    }

    const handleFocus = () => {
      checkAndReset()
      markSeen()
    }

    const handleUserActivity = () => {
      if (document.visibilityState !== 'visible') return
      markSeen()
    }

    handleVisibility()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handleFocus)
    window.addEventListener('keydown', handleUserActivity, { passive: true })
    window.addEventListener('pointerdown', handleUserActivity, { passive: true })

    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') {
        markSeen()
      }
    }, 5 * 60 * 1000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handleFocus)
      window.removeEventListener('keydown', handleUserActivity)
      window.removeEventListener('pointerdown', handleUserActivity)
      clearInterval(heartbeat)
    }
  }, [customUrl, resetActiveSheet])
  const handleAppleSignInNotice = useCallback(() => {
    showAuthNotice('Apple charges $99 for this feature, sorry.')
  }, [showAuthNotice])

  const cleanupPushSubscription = useCallback(async () => {
    if (!pushToken) return
    try {
      await unregisterTokenWithServer({ token: pushToken, authToken: await getAuthToken() })
    } catch (error) {
      log.warn('notifications.push_token_unregister_failed', undefined, error)
    }
    await revokePushToken(pushToken)
    setPushToken(null)
    setPushSyncState('idle')
  }, [pushToken, getAuthToken])

  const syncPushSubscription = useCallback(async () => {
    if (!supportsNotifications) return null
    if (notificationPermission !== 'granted') return null
    if (pushSyncPromiseRef.current) return pushSyncPromiseRef.current
    const pending = (async () => {
      setPushSyncState('syncing')
      setPushSetupError(null)
      try {
        const token = await obtainPushToken()
        if (!token) {
          setPushSyncState('error')
          setPushSetupError('Unable to register for push notifications')
          return null
        }
        setPushToken(token)
        await registerTokenWithServer({
          token,
          timezone: resolvedTimezone,
          appVersion: version,
          authToken: await getAuthToken()
        })
        setPushSyncState('ready')
        return token
      } catch (error) {
        log.error('notifications.push_sync_failed', undefined, error)
        setPushSetupError(error.message)
        setPushSyncState('error')
        return null
      } finally {
        pushSyncPromiseRef.current = null
      }
    })()
    pushSyncPromiseRef.current = pending
    return pending
  }, [supportsNotifications, notificationPermission, resolvedTimezone, getAuthToken])

  const requestNotificationPermission = async () => {
    if (!user) {
      showTimedNotification({ type: 'info', message: 'Sign in to enable notifications.' })
      return
    }
    if (isMobileSafari && !isStandalone) {
      showTimedNotification({
        type: 'info',
        message: 'Add to Home Screen to enable notifications on iOS.'
      })
      return
    }
    if (!supportsNotifications) {
      showTimedNotification({ type: 'error', message: 'Notifications are not supported in this browser.' })
      return
    }
    if (notificationPrompting) return
    setNotificationStatus(null)
    setNotificationPrompting(true)
    try {
      const result = await Notification.requestPermission()
      const resolved = result || (supportsNotifications ? Notification.permission : 'default')
      setNotificationPermission(resolved)
      if (resolved === 'granted') {
        setPushPaused(false)
        showTimedNotification({ type: 'success', message: 'Notifications enabled' })
        syncPushSubscription()
      }
      // No message for denied/dismissed
    } catch (error) {
      setNotificationStatus({ type: 'error', message: `Failed to request permission: ${error.message}` })
    } finally {
      setNotificationPrompting(false)
    }
  }

  useEffect(() => {
    if (notificationPermission === 'granted' && !pushPaused) {
      syncPushSubscription()
    } else if (pushToken) {
      cleanupPushSubscription()
    }
  }, [notificationPermission, pushPaused, syncPushSubscription, cleanupPushSubscription, pushToken])

  const renderInfoPanel = () => (
    <div style={{
      background: '#eceff4', // Nord Snow Storm 2
      border: '1px solid #d8dee9',
      borderRadius: '8px',
      padding: '12px 14px',
      fontSize: '0.85rem',
      boxShadow: '0 1px 3px rgba(46, 52, 64, 0.05)',
      minWidth: '220px',
      maxWidth: '280px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '10px',
        paddingBottom: '10px',
        borderBottom: '1px solid #f3f4f6'
      }}>
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: !hasActiveSchedule
            ? '#9ca3af'
            : isDataStale
              ? '#ff6b6b'
              : connectionStatus === 'online'
                ? '#4caf50'
                : connectionStatus === 'offline'
                  ? '#ff6b6b'
                  : '#ffa500',
          flexShrink: 0
        }} />
        <div style={{flex: 1}}>
          <div style={{color: '#374151', fontWeight: 500, fontSize: '0.8rem'}}>
            {!hasActiveSchedule
              ? 'No Schedule Selected'
              : isDataStale
                ? 'Data Stale'
                : connectionStatus === 'online'
                  ? 'Connected'
                  : connectionStatus === 'offline'
                    ? 'Disconnected'
                    : 'Connecting...'}
          </div>
          <div style={{color: '#6b7280', fontSize: '0.7rem', marginTop: '2px'}}>
            {!hasActiveSchedule
              ? 'Enter a Google Sheets URL to begin'
              : (
                <>
                  Last fetch: {lastFetchTimeDisplay}
                  {connectionStatus !== 'online' && lastSuccessfulFetch && ' (retrying...)'}
                </>
              )}
          </div>
        </div>
      </div>

      {hasActiveSchedule && sheetName && (
        <div>
          <div style={{
            color: '#6b7280',
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '4px'
          }}>
            Schedule
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
            <a
              href={customUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#1f2937',
                fontSize: '0.8rem',
                lineHeight: '1.3',
                textDecoration: customUrl ? 'underline' : 'none',
                cursor: customUrl ? 'pointer' : 'default'
              }}
            >
              {sheetName}
            </a>
            {customUrl && (
              <MdLink style={{ fontSize: '1.1rem', color: '#4b5563', marginLeft: '2px' }} aria-label="Open Google Sheet" />
            )}
          </div>
        </div>
      )}
    </div>
  )
  
  // Fetch cached events from the backend (fast path).
  async function fetchCachedEvents() {
    try {
      setRssLoading(true)
      setHodLoading(true)
      setRssError(null)
      setHodError(null)

      const response = await fetch(cachedEventsEndpoint)
      if (!response.ok) {
        throw new Error(`Events request failed (${response.status})`)
      }
      const payload = await response.json().catch(() => ({}))
      const events = Array.isArray(payload?.events) ? payload.events : []
      setRssEvents(events.filter(ev => ev.source === 'nasa'))
      setHodEvents(events.filter(ev => ev.source === 'hod'))
      setRssLoading(false)
      setHodLoading(false)
    } catch (err) {
      log.error('events.cache_load_failed', undefined, err)
      const message = 'Could not load cached events. You can still paste a Google Sheets URL manually.'
      setRssError(message)
      setHodError(message)
      setRssLoading(false)
      setHodLoading(false)
    }
  }

  // Fetch and parse schedule
  async function fetchSchedule() {
    // No schedule selected: do not fetch and do not surface stale/errors
    if (!hasActiveSchedule) {
      setFetchError(null)
      setScheduleData(createEmptySchedule())
      if (!navigator.onLine) {
        setConnectionStatus('offline')
      } else {
        setConnectionStatus('idle')
      }
      return
    }

    // Skip fetch if offline
    if (!navigator.onLine) {
      setConnectionStatus('offline')
      setFetchError('No internet connection')
      return
    }
    
    try {
      setFetchError(null)
      setConnectionStatus('online')
      let csvText = ''
      let sourceLabel = 'schedule.csv'
      let parserIdToUse = scheduleParserId

    if (customUrl) {
      let spreadsheetId = ''
      let sheetId = null
      let sheetTitle = ''
      let spreadsheetTitle = ''
      let dayTabs = []
      log.debug('sheets_ui.fetch_start', {
        customUrl,
        selectedDay,
        sheetSelection: sheetSelectionRef.current,
        sheetDayTabs
      })

        const cached = sheetSelectionRef.current
        if (cached.url === customUrl) {
          spreadsheetId = cached.spreadsheetId || ''
          sheetTitle = cached.sheetTitle || ''
          spreadsheetTitle = cached.spreadsheetTitle || ''
          if (Number.isFinite(cached.sheetId)) {
            sheetId = cached.sheetId
          }
        }

        if (!spreadsheetId) {
          const resolved = await callSheetsApi('sheets/resolve', {
            method: 'POST',
            body: { url: customUrl }
          })
          spreadsheetId = resolved?.spreadsheetId || ''
        }

        if (!spreadsheetId) {
          throw new Error('Unable to resolve spreadsheet ID from URL.')
        }

        const gidMatch = customUrl.match(/[#&]gid=(\d+)/)
        if (gidMatch) {
          sheetId = Number(gidMatch[1])
        }

        const loadTabs = async () => {
          log.debug('sheets_ui.tabs_fetching', { spreadsheetId })
          const tabsResponse = await callSheetsApi(`sheets/${spreadsheetId}/tabs`)
          const tabs = Array.isArray(tabsResponse) ? tabsResponse : (tabsResponse?.tabs || [])
          const resolvedSpreadsheetTitle = Array.isArray(tabsResponse) ? '' : (tabsResponse?.spreadsheetTitle || '')
          log.debug('sheets_ui.tabs_payload', {
            spreadsheetId,
            spreadsheetTitle: resolvedSpreadsheetTitle,
            tabTitles: tabs.map(tab => tab?.title).filter(Boolean),
            tabIds: tabs.map(tab => tab?.sheetId).filter(id => Number.isFinite(id))
          })
          return { tabs, spreadsheetTitle: resolvedSpreadsheetTitle }
        }

        const { tabs, spreadsheetTitle: tabsSpreadsheetTitle } = await loadTabs()
        dayTabs = buildDayTabs(tabs)
        log.debug('sheets_ui.day_tabs', { dayTabs })
        setSheetDayTabs(dayTabs)
        if (tabsSpreadsheetTitle) {
          spreadsheetTitle = tabsSpreadsheetTitle
        }

        if (dayTabs.length > 0) {
          const preferred = dayTabs.find(entry => entry.day === selectedDay)
            || dayTabs.find(entry => entry.day === DAY_NAMES[nowWithOffset.getDay()])
            || dayTabs[0]
          log.debug('sheets_ui.day_tab_selection', {
            selectedDay,
            nowDay: DAY_NAMES[nowWithOffset.getDay()],
            preferred
          })
          if (!preferred) {
            throw new Error('No day tabs found in the Google Sheet.')
          }
          sheetId = preferred.sheetId
          sheetTitle = preferred.title || sheetTitle
        } else if (!Number.isFinite(sheetId)) {
          log.info('sheets_ui.day_tab_fallback', { selectedDay, tabsCount: tabs.length })
          const chosen = pickBestTab(tabs)
          if (!chosen) {
            throw new Error('No tabs found in the Google Sheet.')
          }
          sheetId = chosen.sheetId
          sheetTitle = chosen.title || sheetTitle
        }

        const tabResponse = await callSheetsApi(`sheets/${spreadsheetId}/tab/${sheetId}`)
        const headers = Array.isArray(tabResponse?.headers) ? tabResponse.headers : []
        const rows = Array.isArray(tabResponse?.rows) ? tabResponse.rows : []
        if (!headers.length && !rows.length) {
          throw new Error('Sheet returned no data.')
        }

        const tabTitle = tabResponse?.sheetTitle || sheetTitle || `Sheet ${sheetId}`
        const tabSpreadsheetTitle = tabResponse?.spreadsheetTitle || spreadsheetTitle || ''
        const displayTitle = tabSpreadsheetTitle
          ? `${tabSpreadsheetTitle} - ${tabTitle}`
          : tabTitle
        csvText = rowsToCsv(headers, rows)
        if (displayTitle) {
          log.debug('sheets_ui.display_title', { displayTitle, tabTitle, tabSpreadsheetTitle })
          setSheetName(displayTitle)
        }

        sheetSelectionRef.current = {
          url: customUrl,
          spreadsheetId,
          sheetId,
          sheetTitle: tabTitle,
          spreadsheetTitle: tabSpreadsheetTitle
        }

        sourceLabel = tabTitle || tabSpreadsheetTitle || customUrl

        const detection = detectParserId({ csvText, sourceLabel })
        parserIdToUse = detection.parserId
        if (parserIdToUse !== scheduleParserId) {
          setScheduleParserId(parserIdToUse)
        }
      } else if (debugMode) {
        if (sheetDayTabs.length) {
          setSheetDayTabs([])
        }
        const csvPath = selectedCsvFile === 'schedule.csv' ? '/schedule.csv' : `/test-schedules/${selectedCsvFile}`
        const response = await fetch(csvPath)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Sheet not found (404). Please check the URL and make sure the sheet is publicly accessible ("Anyone with the link can view"), then try again.')
          }
          throw new Error(`Failed to load sheet (${response.status}): ${response.statusText}`)
        }

        csvText = await response.text()

        if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
          throw new Error('Received HTML instead of CSV. Sheet may not be publicly accessible.')
        }

        sourceLabel = selectedCsvFile
      } else {
        if (sheetDayTabs.length) {
          setSheetDayTabs([])
        }
        return
      }

      const parsedSchedule = parseCsvSchedule({
        csvText,
        parserId: parserIdToUse,
        dayOffset,
        sourceLabel
      })
      setScheduleData(parsedSchedule)
      
      const days = parsedSchedule.days || []
      
      // Auto-select day based on current/mocked time (only if no day is currently selected or if auto-scroll is enabled)
      const todayName = DAY_NAMES[nowWithOffset.getDay()]
      const defaultDay = days.includes(todayName) ? todayName : days[0]
      
      // Only auto-select day if: no day selected yet, or auto-scroll is enabled (user wants automatic updates)
      if (defaultDay && (!selectedDay || autoScrollEnabled)) {
        setSelectedDay(defaultDay)
      } else if (defaultDay && selectedDay && !days.includes(selectedDay)) {
        // If user's selected day doesn't exist in new data, fall back to default
        setSelectedDay(defaultDay)
      }
      setLastFetch(new Date())
      setLastSuccessfulFetch(new Date())
      setConnectionStatus('online')
      setFetchError(null)
      
      // Auto-collapse options panel after successful fetch (only if no errors)
      if (customUrl && optionsExpanded) {
        setOptionsExpanded(false)
      }
    } catch (error) {
      log.error('schedule.fetch_or_parse_failed', undefined, error)
      setConnectionStatus('error')
      
      // Determine error type
      if (!navigator.onLine) {
        setFetchError('No internet connection')
      } else if (error.message && error.message.includes('Unable to determine parser automatically')) {
        setFetchError(error.message)
      } else if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('Sheets API request failed'))) {
        setFetchError('Unable to load Google Sheet. Make sure the sheet is publicly accessible ("Anyone with the link can view"). Check sharing settings and try again.')
      } else if (error.name === 'SyntaxError' || error.message.includes('parse')) {
        setFetchError('Error parsing schedule data. Make sure the Google Sheet follows the correct format.')
      } else {
        setFetchError(`Error loading schedule: ${error.message}`)
      }
      
      // Keep options panel open on error so user can fix the URL
      if (!optionsExpanded) {
        setOptionsExpanded(true)
      }
      
      // Don't update lastFetch on error to show staleness
    }
  }
  
  // Auto-refresh schedule every 30 seconds
  useEffect(() => {
    if (!hasActiveSchedule) return undefined
    fetchSchedule()
    const timer = setInterval(fetchSchedule, 30000)
    return () => clearInterval(timer)
  }, [dayOffset, selectedCsvFile, customUrl, debugMode, hasActiveSchedule, scheduleParserId, dayTabSelectionKey])
  
  useEffect(() => {
    upcomingNotificationTrackerRef.current.clear()
  }, [selectedDay, selectedGroups, selectedCsvFile, customUrl, scheduleParserId])
  
  // Find current and upcoming sessions
  const current = useMemo(() => findCurrentSession(rows, nowWithOffset), [rows, nowWithOffset])
  const relevantActivities = useMemo(() => (
    filterRelevantActivities(activities, selectedDay, selectedGroups)
  ), [activities, selectedDay, selectedGroups])
  const nextSessionsByGroup = useMemo(() => 
    findNextSessionsPerGroup(rows, selectedGroups, nowWithOffset),
    [rows, selectedGroups, nowWithOffset]
  )

  const mobilePrimarySession = current
  const mobileSessionEndStatus = useMemo(
    () => getMobileSessionEndStatus(mobilePrimarySession, nowWithOffset),
    [mobilePrimarySession, nowWithOffset]
  )
  const mobileUpcomingSessions = useMemo(() => {
    if (!rows.length) return []
    const upcoming = rows.filter(session => session?.start && session.start > nowWithOffset)
    return upcoming.sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [rows, nowWithOffset])

  const getPrimaryNextSessionEntry = () => {
    const entries = Object.entries(nextSessionsByGroup)
    if (!entries.length) return null
    const withStarts = entries.filter(([, session]) => session && session.start)
    const sorted = (withStarts.length ? withStarts : entries).sort(([, a], [, b]) => {
      const aTime = a?.start ? a.start.getTime() : Infinity
      const bTime = b?.start ? b.start.getTime() : Infinity
      return aTime - bTime
    })
    return sorted.length ? sorted[0] : null
  }

  const formatMinutesValue = minutes => {
    if (minutes == null || Number.isNaN(minutes)) return 0
    return Math.max(0, Math.round(minutes))
  }

  const buildScheduledNotification = ({ group, session, leadMinutes, eventId }) => {
    if (!session || !session.start) return null
    const fireAt = new Date(session.start.getTime() - leadMinutes * 60000)
    const minutesValue = formatMinutesValue(leadMinutes)
    const startLabel = formatTimeWithAmPm(session.start)
    const title = `${group} on track in ${minutesValue}m`
    const body = `Session starts at ${startLabel}`
    return {
      runGroupId: group,
      sessionStartIsoUtc: session.start.toISOString(),
      offsetMinutes: leadMinutes,
      fireAtIsoUtc: fireAt.toISOString(),
      payload: {
        title,
        body,
        data: {
          eventId,
          runGroupId: group,
          startTime: session.start.toISOString(),
          leadMinutes
        }
      }
    }
  }

  const desiredNotifications = useMemo(() => (
    Object.entries(nextSessionsByGroup)
      .map(([group, session]) => {
        return buildScheduledNotification({
          group,
          session,
          leadMinutes: notificationLeadMinutes,
          eventId
        })
      })
        .filter(Boolean)
      ), [nextSessionsByGroup, notificationLeadMinutes, eventId])

  const formatDebugTimestamp = value => {
    if (!value) return 'never'
    try {
      return new Date(value).toLocaleString()
    } catch (error) {
      return String(value)
    }
  }

  const sendRemoteNotification = useCallback(async ({ title, body, tag, data, reason = 'auto' }) => {
    if (!pushToken) return false
    try {
      await sendServerPush({
        token: pushToken,
        title,
        body,
        tag,
        data,
        authToken: await getAuthToken()
      })
      return true
    } catch (error) {
      log.error('notifications.remote_push_failed', undefined, error)
      if (reason !== 'auto') {
        setNotificationStatus({ type: 'error', message: `Unable to queue push notification: ${error.message}` })
      }
      return false
    }
  }, [pushToken, getAuthToken])

  const forceSchedulerSync = useCallback(async () => {
    if (!syncScheduledNotificationsFn) return
    if (!user || !eventId) return
    if (!supportsNotifications || notificationPermission !== 'granted') return
    if (!pushToken) return

    const nextScheduled = [...desiredNotifications]
      .filter(item => item?.fireAtIsoUtc)
      .sort((a, b) => new Date(a.fireAtIsoUtc).getTime() - new Date(b.fireAtIsoUtc).getTime())[0]

    setSchedulerDebugInfo(prev => ({
      ...prev,
      eventId,
      scheduledCount: desiredNotifications.length,
      nextScheduled: nextScheduled ? {
        runGroupId: nextScheduled.runGroupId,
        fireAtIsoUtc: nextScheduled.fireAtIsoUtc,
        sessionStartIsoUtc: nextScheduled.sessionStartIsoUtc,
        title: nextScheduled.payload?.title,
        body: nextScheduled.payload?.body
      } : null,
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncError: null
    }))

    try {
      await syncScheduledNotificationsFn({
        eventId,
        desiredNotifications
      })
      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncSuccessAt: new Date().toISOString()
      }))
    } catch (error) {
      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncError: error?.message || 'Failed to sync'
      }))
      log.error('notifications.force_scheduler_sync_failed', undefined, error)
    }
  }, [syncScheduledNotificationsFn, user, eventId, supportsNotifications, notificationPermission, pushToken, desiredNotifications])

  const notifyUpcomingSession = async ({ session, group, minutesUntil, reason = 'auto' }) => {
    const etaMinutes = minutesUntil != null
      ? minutesUntil
      : (session.start ? (session.start.getTime() - nowWithOffset.getTime()) / 60000 : null)
    if (!supportsNotifications || notificationPermission !== 'granted') {
      if (reason === 'test') {
        setNotificationStatus({ type: 'info', message: 'Browser is blocking LiveGrid notifications.' })
      }
      return
    }
    const minutesValue = formatMinutesValue(etaMinutes)
    const startLabel = session.start ? formatTimeWithAmPm(session.start) : 'TBD'
    const title = `${group} on track in ${minutesValue}m`
    const body = `Session starts at ${startLabel}`
    const options = {
      body,
      tag: `livegrid-${group}-${session.start ? session.start.getTime() : Date.now()}`,
      renotify: true,
      icon: '/livegrid-icon.png',
      badge: '/livegrid-icon-maskable.png',
      timestamp: Date.now(),
      data: { group, session: session.session, reason }
    }
    const dataPayload = {
      url: appOrigin,
      group,
      session: session.session || 'Session',
      startTime: session.start ? session.start.toISOString() : '',
      reason
    }

    const remoteDelivered = await sendRemoteNotification({ title, body, tag: options.tag, data: dataPayload, reason })
    if (reason !== 'auto') {
      if (remoteDelivered) {
        showTimedNotification({ type: 'success', message: `${group} notification sent (${minutesLabel}).` })
      } else {
        setNotificationStatus({ type: 'error', message: 'Unable to send Firebase notification.' })
      }
    }
  }

  const sendImmediateTestNotification = async () => {
    if (notificationTesting) return
    setNotificationStatus(null)
    setNotificationTesting(true)
    try {
      if (!supportsNotifications) {
        setNotificationStatus({ type: 'error', message: 'Notifications are not supported in this browser.' })
        return
      }
      if (notificationPermission !== 'granted') {
        setNotificationStatus({ type: 'info', message: 'Notifications disabled' })
        return
      }
      if (!pushToken) {
        setNotificationStatus({ type: 'error', message: 'Push token not registered.' })
        return
      }
      const remoteSent = await sendRemoteNotification({
        title: 'LiveGrid test notification',
        body: 'LiveGrid will ping you when your run group is on deck.',
        tag: `livegrid-debug-test-generic-${Date.now()}`,
        data: { url: appOrigin, reason: 'test' },
        reason: 'test'
      })
      if (remoteSent) {
        showTimedNotification({ type: 'success', message: 'Generic test notification sent.' })
        return
      }
      setNotificationStatus({ type: 'error', message: 'Unable to send Firebase notification.' })
    } catch (error) {
      setNotificationStatus({ type: 'error', message: `Unable to send test notification: ${error.message}` })
    } finally {
      setNotificationTesting(false)
    }
  }

  const scheduleMockNotification = async () => {
    if (notificationTesting) return
    setNotificationStatus(null)
    setNotificationTesting(true)
    try {
      if (!syncScheduledNotificationsFn) {
        setNotificationStatus({ type: 'error', message: 'Scheduler is unavailable.' })
        return
      }
      if (!user) {
        setNotificationStatus({ type: 'info', message: 'Sign in to schedule notifications.' })
        return
      }
      if (!supportsNotifications) {
        setNotificationStatus({ type: 'error', message: 'Notifications are not supported in this browser.' })
        return
      }
      if (notificationPermission !== 'granted') {
        setNotificationStatus({ type: 'info', message: 'Notifications disabled' })
        return
      }
      if (!pushToken) {
        setNotificationStatus({ type: 'error', message: 'Push token not registered.' })
        return
      }

      const rawMinutes = Number(mockTestMinutesInput)
      if (Number.isNaN(rawMinutes)) {
        setNotificationStatus({ type: 'error', message: 'Enter a valid number of minutes.' })
        return
      }
      const clampedMinutes = Math.max(1, Math.min(120, Math.round(rawMinutes)))
      if (String(clampedMinutes) !== mockTestMinutesInput) {
        setMockTestMinutesInput(String(clampedMinutes))
      }

      const leadMinutes = Math.max(1, notificationLeadMinutes)
      const fireAt = new Date(Date.now() + clampedMinutes * 60000)
      const leadMs = leadMinutes * 60000
      const sessionStart = new Date(fireAt.getTime() + leadMs)
      const mockSession = { start: sessionStart, session: 'Mock Session' }
      const groupLabel = mockTestGroupInput.trim() || 'Mock Test'
      const mockEventId = eventId ? `${eventId}:mock` : `mock:${Date.now()}`
      const mockNotification = buildScheduledNotification({
        group: groupLabel,
        session: mockSession,
        leadMinutes,
        eventId: mockEventId
      })

      if (!mockNotification) {
        setNotificationStatus({ type: 'error', message: 'Unable to build mock notification.' })
        return
      }

      setSchedulerDebugInfo(prev => ({
        ...prev,
        eventId: mockEventId,
        scheduledCount: 1,
        nextScheduled: {
          runGroupId: mockNotification.runGroupId,
          fireAtIsoUtc: mockNotification.fireAtIsoUtc,
          sessionStartIsoUtc: mockNotification.sessionStartIsoUtc,
          title: mockNotification.payload?.title,
          body: mockNotification.payload?.body
        },
        lastSyncAttemptAt: new Date().toISOString(),
        lastSyncError: null
      }))

      await syncScheduledNotificationsFn({
        eventId: mockEventId,
        desiredNotifications: [mockNotification]
      })

      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncSuccessAt: new Date().toISOString()
      }))
      showTimedNotification({
        type: 'success',
        message: `Mock notification scheduled for ${formatDebugTimestamp(fireAt.toISOString())}.`
      })
    } catch (error) {
      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncError: error?.message || 'Failed to sync'
      }))
      setNotificationStatus({ type: 'error', message: `Unable to schedule mock notification: ${error.message}` })
    } finally {
      setNotificationTesting(false)
    }
  }
  
  const scrollCurrentIntoView = useCallback((behavior = 'smooth') => {
    if (isMobile || !current || !autoScrollEnabled) return
    const list = listRef.current
    if (!list) return

    const idx = rows.findIndex(r =>
      r.start && current.start && r.start.getTime() === current.start.getTime()
    )
    if (idx === -1) return

    const element = itemRefs.current[idx]
    if (!element) return

    const targetTop = element.offsetTop - (list.clientHeight / 2) + (element.clientHeight / 2)
    const maxTop = Math.max(0, list.scrollHeight - list.clientHeight)
    const clampedTop = Math.max(0, Math.min(targetTop, maxTop))

    list.scrollTo({ top: clampedTop, behavior })
  }, [autoScrollEnabled, current, isMobile, rows])

  // Auto-scroll to current session
  useEffect(() => {
    if (isMobile || !current || !autoScrollEnabled) return

    scrollCurrentIntoView('smooth')

    // Re-center after 30 seconds
    const timer = setTimeout(() => {
      if (autoScrollEnabled) {
        scrollCurrentIntoView('smooth')
      }
    }, 30000)

    return () => clearTimeout(timer)
  }, [current, autoScrollEnabled, isMobile, scrollCurrentIntoView])

  // Re-center on layout/resize changes for odd window sizes.
  useEffect(() => {
    if (isMobile || !autoScrollEnabled) return undefined
    const list = listRef.current
    if (!list) return undefined

    let raf = null
    const handleResize = () => {
      if (!autoScrollEnabled) return
      if (raf != null) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => scrollCurrentIntoView('auto'))
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null
    if (observer) observer.observe(list)
    window.addEventListener('resize', handleResize)

    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', handleResize)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [autoScrollEnabled, isMobile, scrollCurrentIntoView])

  useEffect(() => {
    if (!syncScheduledNotificationsFn) return
    if (!user || !eventId) return
    if (!pushToken) return
    if (!supportsNotifications || notificationPermission !== 'granted') return

    const signature = `${eventId}|${notificationLeadMinutes}|${desiredNotifications.map(item => `${item.runGroupId}:${item.sessionStartIsoUtc}`).sort().join('|')}`
    if (scheduleSyncSignatureRef.current === signature) return
    scheduleSyncSignatureRef.current = signature

    const nextScheduled = [...desiredNotifications]
      .filter(item => item?.fireAtIsoUtc)
      .sort((a, b) => new Date(a.fireAtIsoUtc).getTime() - new Date(b.fireAtIsoUtc).getTime())[0]

    setSchedulerDebugInfo(prev => ({
      ...prev,
      eventId,
      scheduledCount: desiredNotifications.length,
      nextScheduled: nextScheduled ? {
        runGroupId: nextScheduled.runGroupId,
        fireAtIsoUtc: nextScheduled.fireAtIsoUtc,
        sessionStartIsoUtc: nextScheduled.sessionStartIsoUtc,
        title: nextScheduled.payload?.title,
        body: nextScheduled.payload?.body
      } : null,
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncError: null
    }))

    syncScheduledNotificationsFn({
      eventId,
      desiredNotifications
    }).then(() => {
      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncSuccessAt: new Date().toISOString()
      }))
    }).catch(error => {
      setSchedulerDebugInfo(prev => ({
        ...prev,
        lastSyncError: error?.message || 'Failed to sync'
      }))
      log.error('notifications.sync_failed', undefined, error)
    })
  }, [eventId, notificationLeadMinutes, desiredNotifications, notificationPermission, pushToken, supportsNotifications, syncScheduledNotificationsFn, user])
  
  // Handle run group selection
  function handleGroupToggle(group) {
    if (group === 'All') {
      setSelectedGroups(prev => 
        prev.length === 1 && prev[0] === 'All' ? [] : ['All']
      )
    } else {
      setSelectedGroups(prev => {
        const withoutAll = prev.filter(g => g !== 'All')
        return withoutAll.includes(group)
          ? withoutAll.filter(g => g !== group)
          : [...withoutAll, group]
      })
    }
  }
  
  // Handle selection of an event from the combined event list
  function handleEventSelect(event) {
    const eventId = event.target.value
    if (!eventId) {
      setSelectedRssEventId('')
      setSelectedHodEventId('')
      return
    }

    const nasaMatch = rssEvents.find(ev => ev.id === eventId)
    if (nasaMatch) {
      setSelectedRssEventId(eventId)
      setSelectedHodEventId('')
      setCustomUrl(nasaMatch.sheetUrl)
    } else {
      const hodMatch = hodEvents.find(ev => ev.id === eventId)
      if (!hodMatch) return
      setSelectedHodEventId(eventId)
      setSelectedRssEventId('')
      setCustomUrl(hodMatch.sheetUrl)
    }

    reportEventSelected({
      authState: user ? 'signed_in' : 'anonymous',
      source: nasaMatch ? 'nasa' : 'hod',
      eventId
    })

    // Exit demo/debug mode and reset offsets when switching to a live sheet
    if (debugMode) {
      setDebugMode(false)
      setClockOffset(0)
      setDayOffset(0)
      setSelectedCsvFile('')
    }
  }
  
  // Dynamic sizing based on content density
  const upcomingCount = Object.entries(nextSessionsByGroup).length
  const isCompactMode = upcomingCount > 3

  const sidebarFullWidth = isMobile ? '240px' : '280px'
  const sidebarCollapsedWidth = isMobile ? '0px' : '60px'
  const mainPadding = isMobile
    ? '12px 16px 24px'
    : sidebarOpen
      ? '16px 48px'
      : '16px 48px 24px 64px'
  const panelPadding = isMobile ? '16px' : '24px'
  const mainPaddingBottomPx = isMobile ? 24 : (sidebarOpen ? 16 : 24)
  const notificationsExpanded = showNotificationsSection && sidebarOpen
  const sidebarBaseSafePadding = safeAreaPaddingExpr
  const sidebarContentPadding = '12px'
  const sidebarScrollPadding = '16px'
  const mainContentPaddingBottom = `calc(${mainPaddingBottomPx}px + ${safeAreaPaddingExpr})`
  const sidebarMenuItemStyles = useMemo(() => ({
    button: {
      '&:hover': {
        backgroundColor: '#88c0d0',
        color: '#2e3440'
      },
      padding: '12px 16px',
      margin: '8px',
      transition: 'background 0.2s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: sidebarOpen ? 'flex-start' : 'center',
      color: '#b4c6dd'
    },
    icon: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '24px',
      margin: sidebarOpen ? '0' : '0 auto',
      color: '#b4c6dd'
    }
  }), [sidebarOpen])
  
  return (
    <div style={{ display: 'flex', height: viewportHeightStyle, minHeight: viewportMinHeightStyle }}>
      {notificationStatus && notificationStatus.message && (
        <div
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 2000,
            background: notificationStatus.type === 'error'
              ? 'rgba(248,113,113,0.18)'
              : notificationStatus.type === 'success'
                ? 'rgba(16,185,129,0.18)'
                : 'rgba(59,130,246,0.18)',
            border: notificationStatus.type === 'error'
              ? '1px solid rgba(248,113,113,0.5)'
              : notificationStatus.type === 'success'
                ? '1px solid rgba(16,185,129,0.45)'
                : '1px solid rgba(59,130,246,0.45)',
            color: notificationStatus.type === 'error'
              ? '#fecaca'
              : notificationStatus.type === 'success'
                ? '#bbf7d0'
                : '#bfdbfe',
            borderRadius: '10px',
            padding: '12px 14px',
            fontSize: '0.85rem',
            maxWidth: '320px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            opacity: notificationStatus.fading ? 0 : 1,
            transition: 'opacity 1s ease'
          }}
        >
          {notificationStatus.message}
        </div>
      )}
      {/* React Pro Sidebar */}
      <Sidebar
        collapsed={!sidebarOpen && !isMobile}
        width={sidebarFullWidth}
        collapsedWidth={sidebarCollapsedWidth}
        backgroundColor="#2e3440"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 1000,
          border: 'none',
          borderRight: '1px solid #3b4252',
          height: viewportHeightStyle,
          paddingBottom: sidebarBaseSafePadding,
          background: '#2e3440',
          borderRadius: isMobile && hasToolbarInset ? '0 18px 18px 0' : 0,
          overflow: isMobile && hasToolbarInset ? 'hidden' : 'visible',
          boxShadow: '2px 0 12px 0 rgba(0,0,0,0.12)',
          transform: isMobile && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 0.3s ease'
        }}
      >
        <div style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: sidebarContentPadding,
          boxSizing: 'border-box'
        }}>
          {/* Sidebar Header */}
          <div style={{
            padding: '20px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            borderBottom: '1px solid rgba(226,232,240,0.35)',
            backgroundColor: '#0b1220',
            backgroundImage: sidebarOpen
              ? "url('/livegrid-header-logo.png')"
              : "url('/livegrid-icon-maskable.png')",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: sidebarOpen
              ? (isMobile ? '100% auto' : 'cover')
              : 'cover',
            width: '100%',
            height: '80px',
            boxSizing: 'border-box'
          }} />

          <div style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflow: 'visible',
            paddingBottom: sidebarScrollPadding
          }}>

          {/* Menu Items */}
          <Menu menuItemStyles={sidebarMenuItemStyles}>
            {/* Fullscreen */}
            {!isMobile && (
              <MenuItem
                icon={document.fullscreenElement ? <MdFullscreenExit size={20} /> : <MdFullscreen size={20} />}
                onClick={() => {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen()
                  } else {
                    document.exitFullscreen()
                  }
                }}
              >
                Fullscreen
              </MenuItem>
            )}

            {/* Settings */}
            <MenuItem
              icon={<MdSettings size={20} />}
              onClick={() => setOptionsExpanded(!optionsExpanded)}
            >
              Settings
            </MenuItem>

            {/* Demo */}


            {/* Notifications */}
            <MenuItem
              icon={notificationPermission === 'granted' ? <MdNotificationsActive size={20} /> : <MdNotificationsPaused size={20} />}
              onClick={() => {
                if (!sidebarOpen) {
                  setSidebarOpen(true)
                  setShowNotificationsSection(true)
                  setShowAccountSection(false)
                  setShowHelpSection(false)
                  return
                }
                setShowNotificationsSection(prev => {
                  const next = !prev
                  if (next) {
                    if (showAccountSection) setShowAccountSection(false)
                    if (showHelpSection) setShowHelpSection(false)
                  }
                  return next
                })
              }}
            >
              Notifications
            </MenuItem>
          </Menu>
          {/* Notifications Slide-Out */}
          <div
            style={{
              margin: '0 16px 12px 16px',
              padding: notificationsExpanded ? '24px 20px 20px 20px' : '0 16px',
              borderRadius: '14px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#1f2630',
              color: '#e5e9f0',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxHeight: notificationsExpanded ? 'calc(var(--vp-dvh, 100dvh) * 0.7)' : 0,
              overflowX: 'hidden',
              overflowY: notificationsExpanded ? 'auto' : 'hidden',
              transition: 'max-height 0.4s cubic-bezier(.4,0,.2,1), padding 0.3s cubic-bezier(.4,0,.2,1)',
              display: sidebarOpen ? 'block' : 'none'
            }}
          >
            {notificationsExpanded && (
              <>
                {notificationStatus && notificationStatus.message && (
                  <div
                    style={{
                      background: notificationStatus.type === 'error' ? 'rgba(248,113,113,0.18)' : notificationStatus.type === 'success' ? 'rgba(16,185,129,0.18)' : 'rgba(59,130,246,0.18)',
                      border: notificationStatus.type === 'error' ? '1px solid rgba(248,113,113,0.5)' : notificationStatus.type === 'success' ? '1px solid rgba(16,185,129,0.45)' : '1px solid rgba(59,130,246,0.45)',
                      color: notificationStatus.type === 'error' ? '#fecaca' : notificationStatus.type === 'success' ? '#bbf7d0' : '#bfdbfe',
                      borderRadius: '8px',
                      padding: '10px',
                      fontSize: '0.85rem',
                      marginBottom: '12px',
                      opacity: notificationStatus.fading ? 0 : 1,
                      transition: 'opacity 1s ease'
                    }}
                  >
                    {notificationStatus.message}
                  </div>
                )}
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px'}}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (notificationPermission === 'granted') {
                        // Simulate disabling by setting permission to 'default' (cannot revoke via API)
                        await cleanupPushSubscription()
                        setPushPaused(true)
                        setNotificationPermission('default')
                        showTimedNotification({ type: 'info', message: 'Notifications disabled' })
                      } else {
                        setPushPaused(false)
                        requestNotificationPermission()
                      }
                    }}
                    disabled={notificationPrompting}
                    style={{
                      flex: '1 1 140px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      background: notificationPermission === 'granted' ? '#2f3a4c' : '#5e81ac',
                      color: '#f0f4ff',
                      fontWeight: 600,
                      cursor: notificationPrompting ? 'wait' : 'pointer'
                    }}
                  >
                    {notificationPermission === 'granted' ? 'Disable notifications' : (notificationPrompting ? 'Requesting...' : 'Enable notifications')}
                  </button>
                </div>
                <div style={{marginBottom: '10px'}}>
                  <label htmlFor="notification-lead" style={{fontWeight: 500, fontSize: '0.97em', display: 'block', marginBottom: '2px'}}>Notify me</label>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input
                      id="notification-lead"
                      type="number"
                      min={1}
                      max={120}
                      value={notificationLeadInput}
                      onChange={e => {
                        const value = e.target.value
                        setNotificationLeadInput(value)
                        if (value === '') return
                        const raw = Number(value)
                        if (Number.isNaN(raw)) return
                        const clamped = Math.max(1, Math.min(120, Math.round(raw)))
                        setNotificationLeadMinutes(clamped)
                      }}
                      onBlur={() => {
                        if (notificationLeadInput === '') {
                          setNotificationLeadInput(String(notificationLeadMinutes))
                        }
                      }}
                      style={{width: '56px', padding: '4px 6px', borderRadius: '5px', border: '1px solid #444', background: '#181c23', color: '#e5e9f0', fontSize: '0.97em'}}
                    />
                    <span style={{color: '#a0aec0', fontSize: '0.97em'}}>minutes before session</span>
                  </div>
                </div>
              </>
            )}
          </div>
          <Menu menuItemStyles={sidebarMenuItemStyles}>
            {/* Account Menu Item */}
            <MenuItem
              icon={<GiFullMotorcycleHelmet size={20} />}
              onClick={() => {
                if (!sidebarOpen) {
                  setSidebarOpen(true)
                  setShowAccountSection(true)
                  setShowHelpSection(false)
                  setShowNotificationsSection(false)
                  return
                }
                setShowAccountSection(prev => {
                  const next = !prev
                  if (next) {
                    if (showHelpSection) setShowHelpSection(false)
                    if (showNotificationsSection) setShowNotificationsSection(false)
                  }
                  return next
                })
              }}
            >
              Account
            </MenuItem>
          </Menu>
          {/* Account Slide-Out */}
          <div
            className="account-panel"
            ref={accountPanelRef}
            style={{
              margin: '0 16px 16px 16px',
              padding: showAccountSection && sidebarOpen ? '16px 20px 18px 20px' : '0 16px',
              borderRadius: '14px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#1f2630',
              color: '#e5e9f0',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxHeight: showAccountSection && sidebarOpen
                ? (accountPanelMaxHeight ? `${accountPanelMaxHeight}px` : 'calc(var(--vp-dvh, 100dvh) * 0.6)')
                : 0,
              overflowX: 'hidden',
              overflowY: showAccountSection && sidebarOpen ? 'auto' : 'hidden',
              overscrollBehavior: 'contain',
              transition: 'max-height 0.4s cubic-bezier(.4,0,.2,1), padding 0.3s cubic-bezier(.4,0,.2,1)',
              display: sidebarOpen ? 'block' : 'none'
            }}
          >
            {showAccountSection && sidebarOpen && (
              <>
                {user ? (
                  <>
                    <div style={{fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7}}>
                      Synced Account
                    </div>
                    <div style={{fontWeight: 600, margin: '6px 0 10px 0'}}>
                      {user.displayName || user.email || 'Signed in'}
                    </div>
                    <button
                      type="button"
                      onClick={signOutUser}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(229,233,240,0.35)',
                        background: 'transparent',
                        color: '#e5e9f0',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{
                      fontSize: '0.8rem',
                      lineHeight: 1.4,
                      marginBottom: '12px',
                      color: '#cbd5e1',
                      textAlign: 'center'
                    }}>
                      Sign in to sync your schedule and preferences.
                    </div>
                    {authNotice && (
                      <div
                        style={{
                          background: 'rgba(59,130,246,0.18)',
                          border: '1px solid rgba(59,130,246,0.45)',
                          color: '#bfdbfe',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '0.8rem',
                          marginBottom: '10px',
                          textAlign: 'center'
                        }}
                      >
                        {authNotice}
                      </div>
                    )}
                    <FirebaseAuthUI onAppleSignInClick={handleAppleSignInNotice} />
                    {authError && (
                      <div style={{marginTop: '10px', fontSize: '0.78rem', color: '#fca5a5'}}>
                        {authError.message || 'Sign-in failed. Please try again.'}
                      </div>
                    )}
                  </>
                )}
                {authLoading && user && (
                  <div style={{marginTop: '12px', fontSize: '0.75rem', opacity: 0.7}}>Syncing preferences…</div>
                )}
              </>
            )}
          </div>
          </div>
          <div style={{flex: '0 0 auto', display: 'flex', flexDirection: 'column', marginTop: 'auto'}}>
          {/* Help Toggle + Drawer */}
          <div
            ref={helpSectionRef}
            style={{
              padding: sidebarOpen ? '0 12px 8px 12px' : '0 0 8px 0'
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!sidebarOpen) {
                  setSidebarOpen(true)
                  setShowHelpSection(true)
                  setShowAccountSection(false)
                  setShowNotificationsSection(false)
                  return
                }
                setShowHelpSection(prev => {
                  const next = !prev
                  if (next) {
                    if (showAccountSection) setShowAccountSection(false)
                    if (showNotificationsSection) setShowNotificationsSection(false)
                  }
                  return next
                })
              }}
              aria-expanded={showHelpSection}
              style={{
                width: sidebarOpen ? '100%' : '44px',
                minWidth: 0,
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                gap: sidebarOpen ? 10 : 0,
                padding: sidebarOpen ? '12px 16px' : '12px 0',
                margin: sidebarOpen ? '8px' : '8px auto',
                boxSizing: 'border-box',
                borderRadius: 0,
                border: 'none',
                background: 'transparent',
                color: '#b4c6dd',
                cursor: 'pointer',
                transition: 'background 0.2s, color 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#88c0d0'
                e.currentTarget.style.color = '#2e3440'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#b4c6dd'
              }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '24px',
                margin: sidebarOpen ? '0' : '0 auto',
                color: '#b4c6dd'
              }}>
                <MdHelpOutline size={20} />
              </span>
              {sidebarOpen && <span style={{fontSize: '0.95rem', fontWeight: 500}}>Help</span>}
            </button>
            <div
              style={{
                margin: '0 12px',
                padding: showHelpSection && sidebarOpen ? '20px 0 6px 0' : '0 0',
                background: 'transparent',
                color: '#d8dee9',
                fontSize: '0.95rem',
                border: 'none',
                maxHeight: showHelpSection && sidebarOpen ? 420 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.4s cubic-bezier(.4,0,.2,1), padding 0.3s cubic-bezier(.4,0,.2,1)',
                display: sidebarOpen ? 'block' : 'none'
              }}
            >
              {showHelpSection && sidebarOpen && (
                <>
                  <div style={{marginBottom: 4, fontWeight: 500, color: '#e5e9f0'}}>Having issues?</div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: 10,
                    marginBottom: 4,
                    paddingTop: '0.75em',
                    paddingBottom: '0.75em'
                  }}>
                    <a
                      href="mailto:brandon@stro.io?subject=LiveGrid%20Issue"
                      style={{
                        color: '#000',
                        background: '#fff',
                        border: '1.5px solid #000',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        transition: 'background 0.2s, color 0.2s',
                        boxSizing: 'border-box'
                      }}
                      title="Email brandon@stro.io"
                    >
                      <FaEnvelope size={18} color="#000" />
                    </a>
                    <a
                      href="https://discord.com/users/362053962637246464"
                      style={{
                        color: '#000',
                        background: '#fff',
                        border: '1.5px solid #000',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        transition: 'background 0.2s, color 0.2s',
                        boxSizing: 'border-box'
                      }}
                      title="DM on Discord"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FaDiscord size={18} color="#000" />
                    </a>
                    <a
                      href="https://ig.me/m/stro38x"
                      style={{
                        color: '#000',
                        background: '#fff',
                        border: '1.5px solid #000',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        transition: 'background 0.2s, color 0.2s',
                        boxSizing: 'border-box'
                      }}
                      title="DM on Instagram"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FaInstagram size={18} color="#000" />
                    </a>
                  </div>
                  <div style={{color: '#e5e9f0', fontSize: '0.97em', marginLeft: 2, marginBottom: 12}}>
                    ...or come find me in the paddock
                  </div>
                  <hr style={{border: 0, borderTop: '1px solid rgba(255,255,255,0.12)', margin: '12px 0 10px 0'}} />
                  <div style={{display: 'flex', gap: 12, marginBottom: 8, justifyContent: 'flex-start'}}>
                    <button
                      onClick={() => setShowDebugPanel(v => !v)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2,
                        background: '#5e81ac', color: '#eceff4', border: '1px solid #5e81ac', borderRadius: 3,
                        padding: '0 6px', fontWeight: 500, fontSize: '0.75rem', cursor: 'pointer',
                        transition: 'background 0.2s, color 0.2s',
                        height: 22,
                        minWidth: 0
                      }}
                    >
                      <MdBuild size={11} style={{marginRight: 1}} />
                      Debug
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date()
                        const currentDay = now.getDay()
                        let daysUntilSaturday = (6 - currentDay + 7) % 7
                        if (daysUntilSaturday === 0 && currentDay === 6) {
                          daysUntilSaturday = 0
                        }
                        const target = new Date(now)
                        target.setDate(target.getDate() + daysUntilSaturday)
                        target.setHours(10, 30, 0, 0)
                        const nowDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                        const targetDayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())
                        const dayDiff = Math.round((targetDayStart - nowDayStart) / 86400000)
                        const nowTimeMs = now.getTime() - nowDayStart.getTime()
                        const targetTimeMs = target.getTime() - targetDayStart.getTime()
                        const clockMinutes = Math.round((targetTimeMs - nowTimeMs) / 60000)
                        setDayOffset(dayDiff)
                        setClockOffset(clockMinutes)
                        if (!debugMode) setDebugMode(true)
                        setSelectedCsvFile('2026 New Year, New Gear - Schedule.csv')
                        setCustomUrl('')
                        setSelectedDay('Saturday')
                        setSelectedGroups(['HPDE 1', 'TT Omega'])
                        setOptionsExpanded(false)
                      }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2,
                        background: '#5e81ac', color: '#eceff4', border: '1px solid #5e81ac', borderRadius: 3,
                        padding: '0 6px', fontWeight: 500, fontSize: '0.75rem', cursor: 'pointer',
                        transition: 'background 0.2s, color 0.2s',
                        height: 22,
                        minWidth: 0
                      }}
                    >
                      <MdPlayArrow size={11} style={{marginRight: 1}} />
                      Demo
                    </button>
                  </div>
                  <hr style={{border: 0, borderTop: '1px solid rgba(255,255,255,0.12)', margin: '10px 0 0 0'}} />
                </>
              )}
            </div>
          </div>
          {/* Build Number & Instagram */}
          <div style={{
            padding: '10px 16px',
            paddingBottom: '10px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarOpen ? 'space-between' : 'center',
            fontSize: '0.75rem',
            color: '#999'
          }}>
            <span>v{version}</span>
            {sidebarOpen && (
              <a 
                href="https://www.instagram.com/stro38x" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#999',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                  fontSize: '0.75rem'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#0b74de'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
              >
                <FaInstagram size={16} />
                <span>stro38x</span>
              </a>
            )}
          </div>
          </div>
        </div>
      </Sidebar>

      {/* Main Content Wrapper - Controls viewport filling */}
      <div
        onClick={() => {
          if (isMobile && sidebarOpen) setSidebarOpen(false)
        }}
        style={{
        marginLeft: isMobile ? '0px' : (sidebarOpen ? sidebarFullWidth : sidebarCollapsedWidth),
        transition: 'margin-left 0.3s ease',
        flex: 1,
        padding: mainPadding,
        paddingBottom: mainContentPaddingBottom,
        // backgroundColor: '#2e3440',
        minHeight: viewportMinHeightStyle,
        height: showDebugPanel ? 'auto' : viewportHeightStyle, // Auto height when debug panel is open
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}>
      {!isMobile && (
        <button
          type="button"
          onClick={() => setSidebarOpen(prev => !prev)}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          style={{
            position: 'fixed',
            top: '14px',
            left: `calc(${sidebarOpen ? sidebarFullWidth : sidebarCollapsedWidth} + 14px)`,
            zIndex: 1201,
            background: '#f8f9fa',
            border: '1px solid #e5e7eb',
            color: '#1f2937',
            padding: '8px',
            cursor: 'pointer',
            borderRadius: '10px',
            fontSize: '1.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#e5e7eb'; e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#f8f9fa'; e.currentTarget.style.transform = 'scale(1)'; }}
        >
          {sidebarOpen ? <MdClose size={18} /> : <MdMenu size={20} />}
        </button>
      )}
      {isMobile && !sidebarOpen && (
        <button
          className="mobile-menu-button"
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <span style={{fontSize: '1.2rem', lineHeight: 1}}>☰</span>
        </button>
      )}

      {/* Header with Clock and Info Panel */}
      <div style={{
        display: 'flex',
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        justifyContent: isMobile ? 'center' : 'space-between',
        alignItems: isMobile ? 'center' : 'flex-start',
        textAlign: isMobile ? 'center' : 'left',
        marginBottom: isMobile ? '12px' : '16px',
        gap: isMobile ? '12px' : '20px',
        width: '100%'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'center' : 'flex-start',
          gap: isMobile ? '12px' : '24px',
          flex: isMobile ? '1 1 100%' : '1 1 auto'
        }}>
          <div style={{
            flex: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <h1 className="clock" style={{margin: 0, whiteSpace: 'nowrap', fontSize: isMobile ? '3.2rem' : undefined}}>
              {(() => {
                const hours = nowWithOffset.getHours() % 12 || 12
                const mins = String(nowWithOffset.getMinutes()).padStart(2, '0')
                const secs = String(nowWithOffset.getSeconds()).padStart(2, '0')
                const ampm = nowWithOffset.getHours() >= 12 ? 'PM' : 'AM'
                return <>{hours}:{mins}:{secs}<span className="clock-ampm">{ampm}</span></>
              })()}
            </h1>
          </div>

          {!isMobile && (
            <div style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              {renderInfoPanel()}
            </div>
          )}
        </div>
      </div>
      
      
      {/* Debug Controls */}
      {showDebugPanel && (
        <div className="debug-controls">
          <div style={{marginBottom: '16px', fontSize: '0.9rem', background: '#fffbea', padding: '12px', borderRadius: '4px', border: '1px solid #f0e68c'}}>
            <strong>Time Offset:</strong><br/>
            Real time: {now.toLocaleString()}<br/>
            Real day: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]}<br/>
            Mocked time: {nowWithOffset.toLocaleString()}<br/>
            Mocked day: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nowWithOffset.getDay()]}<br/>
            Selected day: {selectedDay || 'None'}<br/>
            Day offset: {dayOffset} days<br/>
            Current session: {current ? current.session : 'None'}<br/>
            First session date: {rows.length > 0 && rows[0].start ? rows[0].start.toLocaleString() : 'None'}<br/>
            First session day: {rows.length > 0 && rows[0].start ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][rows[0].start.getDay()] : 'None'}
          </div>
          
          <div style={{marginBottom: '16px', fontSize: '0.9rem', background: '#e3f2fd', padding: '12px', borderRadius: '4px', border: '1px solid #90caf9'}}>
            <strong>Schedule Info:</strong><br/>
            Source: {customUrl ? 'Google Sheets' : 'Local CSV'}<br/>
            Parser: {scheduleParser ? scheduleParser.name : scheduleParserId}<br/>
            {customUrl && (
              <>
                Sheet Name: {sheetName || 'Loading...'}<br/>
                Sheet URL: <span style={{fontSize: '0.8rem', wordBreak: 'break-all', fontFamily: 'monospace'}}>{customUrl}</span><br/>
              </>
            )}
            {!customUrl && debugMode && (
              <>Local File: {selectedCsvFile}<br/></>
            )}
            Total Sessions (all days): {sessions.length}<br/>
            Sessions (selected day): {rows.length}<br/>
            Run Groups: {groups.join(', ') || 'None'}<br/>
            Selected Groups: {selectedGroups.join(', ')}<br/>
            Activities Found: {relevantActivities.length}<br/>
            Upcoming Sessions: {Object.keys(nextSessionsByGroup).length} groups
          </div>
          
          <div style={{marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px', border: '1px solid #ddd'}}>
            <label htmlFor="debug-csv-file" style={{display: 'block', marginBottom: '8px', fontWeight: 600}}>Local Schedule File:</label>
            <select
              id="debug-csv-file"
              value={selectedCsvFile}
              onChange={e => setSelectedCsvFile(e.target.value)}
              style={{padding: '8px', width: '100%', fontSize: '0.9rem', marginBottom: '12px'}}
            >
              <option value="schedule.csv">schedule.csv (default)</option>
              <option value="2024 Brady Memorial - Schedule.csv">2024 Brady Memorial</option>
              <option value="2025 Spring Brake - Schedule.csv">2025 Spring Brake</option>
              <option value="2026 New Year, New Gear - Schedule.csv">2026 New Year, New Gear</option>
            </select>
          </div>
          
          <div style={{display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap'}}>
            <div>
              <label htmlFor="clock-offset" style={{marginRight: '8px', fontWeight: 500}}>Clock Offset (min):</label>
              <input
                id="clock-offset"
                type="number"
                min={-720}
                max={720}
                step={1}
                value={clockOffsetInput}
                onChange={e => {
                  const value = e.target.value
                  setClockOffsetInput(value)
                  if (value === '' || value === '-' || value === '+') return
                  const parsed = Number(value)
                  if (!Number.isNaN(parsed)) {
                    setClockOffset(parsed)
                  }
                }}
                onBlur={() => {
                  if (clockOffsetInput === '' || clockOffsetInput === '-' || clockOffsetInput === '+') {
                    setClockOffsetInput(String(clockOffset))
                    return
                  }
                  const parsed = Number(clockOffsetInput)
                  if (Number.isNaN(parsed)) {
                    setClockOffsetInput(String(clockOffset))
                    return
                  }
                  setClockOffset(parsed)
                }}
                style={{padding: '6px', width: '80px'}}
              />
              <button
                type="button"
                onClick={() => setClockOffset(0)}
                disabled={clockOffset === 0}
                style={{marginLeft: '8px', padding: '6px 12px'}}
              >
                Reset
              </button>
            </div>
            
            <div>
              <label htmlFor="day-offset" style={{marginRight: '8px', fontWeight: 500}}>Day Offset (days):</label>
              <input
                id="day-offset"
                type="number"
                min={-7}
                max={7}
                step={1}
                value={dayOffsetInput}
                onChange={e => {
                  const value = e.target.value
                  setDayOffsetInput(value)
                  if (value === '' || value === '-' || value === '+') return
                  const parsed = Number(value)
                  if (!Number.isNaN(parsed)) {
                    setDayOffset(parsed)
                  }
                }}
                onBlur={() => {
                  if (dayOffsetInput === '' || dayOffsetInput === '-' || dayOffsetInput === '+') {
                    setDayOffsetInput(String(dayOffset))
                    return
                  }
                  const parsed = Number(dayOffsetInput)
                  if (Number.isNaN(parsed)) {
                    setDayOffsetInput(String(dayOffset))
                    return
                  }
                  setDayOffset(parsed)
                }}
                style={{padding: '6px', width: '80px'}}
              />
              <button
                type="button"
                onClick={() => setDayOffset(0)}
                disabled={dayOffset === 0}
                style={{marginLeft: '8px', padding: '6px 12px'}}
              >
                Reset
              </button>
            </div>
          </div>
          
          <div style={{marginTop: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px', border: '1px solid #ddd'}}>
            <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
              <input
                type="checkbox"
                checked={forceShowStaleBanner}
                onChange={e => setForceShowStaleBanner(e.target.checked)}
              />
              <span style={{fontWeight: 500}}>Force show stale data banner</span>
            </label>
          </div>

          <div style={{marginTop: '16px', padding: '14px', background: '#eef2ff', borderRadius: '6px', border: '1px solid #c7d2fe'}}>
            <div style={{fontWeight: 600, marginBottom: '10px'}}>Notifications (debug)</div>
            <div style={{fontSize: '0.9rem', marginBottom: '10px', color: '#1e3a8a'}}>
              Support: {supportsNotifications ? 'Available' : 'Not supported'}<br/>
              Permission: {supportsNotifications ? notificationPermission : 'unsupported'}<br/>
              Service Worker: {serviceWorkerRegistrationState}<br/>
              Push token: {pushToken ? 'Registered' : 'Not registered'}<br/>
              Push sync: {pushSyncState}{pushSetupError ? ` - ${pushSetupError}` : ''}<br/>
              Lead time: {notificationLeadMinutes}m<br/>
            </div>
            <div style={{fontSize: '0.82rem', color: '#334155'}}>
              Last status: {notificationStatus ? notificationStatus.message : 'None'}<br/>
              Test status: {notificationTesting ? 'sending...' : 'idle'}<br/>
              Scheduler last update: {formatDebugTimestamp(schedulerDebugInfo.lastSyncSuccessAt)}<br/>
              Scheduler last attempt: {formatDebugTimestamp(schedulerDebugInfo.lastSyncAttemptAt)}<br/>
              Scheduler last error: {schedulerDebugInfo.lastSyncError || 'None'}<br/>
              Scheduler event: {schedulerDebugInfo.eventId || 'None'}<br/>
              Scheduled count: {schedulerDebugInfo.scheduledCount || 0}<br/>
              Next scheduled: {schedulerDebugInfo.nextScheduled
                ? `${schedulerDebugInfo.nextScheduled.title || schedulerDebugInfo.nextScheduled.runGroupId || 'Unknown'} @ ${formatDebugTimestamp(schedulerDebugInfo.nextScheduled.fireAtIsoUtc)}`
                : 'None'}
            </div>
            <div style={{marginTop: '12px', padding: '10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #cbd5f5'}}>
              <div style={{fontWeight: 600, marginBottom: '8px', color: '#1e3a8a'}}>Test notifications</div>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center'}}>
                <button
                  type="button"
                  onClick={sendImmediateTestNotification}
                  disabled={!supportsNotifications || notificationPermission !== 'granted' || !pushToken || notificationTesting}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #94a3b8',
                    background: '#fff',
                    color: '#1e293b',
                    fontWeight: 600,
                    cursor: notificationTesting ? 'wait' : (notificationPermission === 'granted' ? 'pointer' : 'not-allowed')
                  }}
                >
                  {notificationTesting ? 'Sending...' : 'Send immediate test'}
                </button>
                <div style={{display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap'}}>
                  <input
                    type="text"
                    value={mockTestGroupInput}
                    onChange={e => setMockTestGroupInput(e.target.value)}
                    onBlur={() => {
                      if (mockTestGroupInput.trim() === '') {
                        setMockTestGroupInput('Mock Test')
                      }
                    }}
                    placeholder="Run group label"
                    aria-label="Mock run group label"
                    style={{width: '160px', padding: '4px 6px', borderRadius: '5px', border: '1px solid #94a3b8'}}
                  />
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={mockTestMinutesInput}
                    onChange={e => setMockTestMinutesInput(e.target.value)}
                    onBlur={() => {
                      if (mockTestMinutesInput === '') {
                        setMockTestMinutesInput('2')
                        return
                      }
                      const raw = Number(mockTestMinutesInput)
                      if (Number.isNaN(raw)) {
                        setMockTestMinutesInput('2')
                        return
                      }
                      const clamped = Math.max(1, Math.min(120, Math.round(raw)))
                      setMockTestMinutesInput(String(clamped))
                    }}
                    style={{width: '64px', padding: '4px 6px', borderRadius: '5px', border: '1px solid #94a3b8'}}
                  />
                  <span style={{fontSize: '0.85rem', color: '#475569'}}>minutes from now</span>
                  <button
                    type="button"
                    onClick={scheduleMockNotification}
                    disabled={!syncScheduledNotificationsFn || !user || !pushToken || notificationPermission !== 'granted' || notificationTesting}
                    style={{padding: '6px 10px', borderRadius: '6px'}}
                  >
                    Schedule mock test
                  </button>
                </div>
              </div>
              <div style={{marginTop: '6px', fontSize: '0.75rem', color: '#64748b'}}>
                Scheduled mock uses the same scheduler flow as real notifications.
              </div>
            </div>
            <div style={{marginTop: '10px'}}>
              <button
                type="button"
                onClick={forceSchedulerSync}
                disabled={!syncScheduledNotificationsFn || !user || !eventId || !pushToken || notificationPermission !== 'granted'}
                style={{padding: '6px 12px'}}
              >
                Sync scheduler now
              </button>
            </div>
          </div>

        </div>
      )}
      
      {/* Options Controls */}
      {optionsExpanded && (
        <div style={{marginBottom: '24px', padding: '20px', background: '#f8f9fa', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'}}>
          <div style={{marginBottom: '18px', color: '#334155', fontSize: '0.98rem', lineHeight: 1.5}}>
             LiveGrid displays schedule information from publicly available sources and is not affiliated with or endorsed by any event organizer. Always refer to the official schedule published by the event organizers.
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
            <div>
              <div style={{marginBottom: '12px'}}>
                <label style={{display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px', fontWeight: 500}}>
                  <span>Events</span>
                  {rssLoading && (
                    <span style={{fontSize: '0.8rem', color: '#666'}}>
                      Loading nasa-se.com...
                    </span>
                  )}
                  {hodLoading && (
                    <span style={{fontSize: '0.8rem', color: '#666'}}>
                      Loading MotorsportReg...
                    </span>
                  )}
                </label>
                {!rssLoading && rssError && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: '#c62828',
                    background: '#ffebee',
                    border: '1px solid #ef5350',
                    borderRadius: '4px',
                    padding: '8px',
                    marginBottom: '6px'
                  }}>
                    {rssError}
                  </div>
                )}
                {!hodLoading && hodError && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: '#c62828',
                    background: '#ffebee',
                    border: '1px solid #ef5350',
                    borderRadius: '4px',
                    padding: '8px',
                    marginBottom: '6px'
                  }}>
                    {hodError}
                  </div>
                )}
                {combinedEvents.length > 0 && (
                  <>
                    <select
                      value={selectedEventId}
                      onChange={handleEventSelect}
                      style={{width: '100%', padding: '8px', fontSize: '0.9rem', marginBottom: '4px'}}
                    >
                      <option value="">Select an event...</option>
                      {combinedEvents.map(ev => (
                        <option key={ev.id} value={ev.id}>{ev.label}</option>
                      ))}
                    </select>
                    <div style={{fontSize: '0.8rem', color: '#666'}}>
                    </div>
                  </>
                )}
              </div>
              
              <label style={{display: 'block', marginBottom: '8px', fontWeight: 500}}>
                Google Sheets URL:
              </label>
              
              <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <input
                  type="text"
                  value={customUrl}
                  onChange={e => {
                    setCustomUrl(e.target.value)
                    // Exit demo mode and reset offsets when URL is changed
                    if (e.target.value && debugMode) {
                      setDebugMode(false)
                      setClockOffset(0)
                      setDayOffset(0)
                      setSelectedCsvFile('')
                    }
                  }}
                  placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    backgroundColor: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  type="button"
                  title="Reset active sheet"
                  onClick={resetActiveSheet}
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.9rem',
                    border: '2px solid #d32f2f',
                    borderRadius: '4px',
                    background: '#fff',
                    color: '#d32f2f',
                    cursor: 'pointer',
                    marginLeft: '4px'
                  }}
                >Reset</button>
              </div>
              <div style={{marginTop: '4px', fontSize: '0.8rem', color: '#666', fontStyle: 'italic'}}>
                Event not found above? Paste the Google Sheets URL directly.
              </div>
              
              {customUrl && (
                <div style={{marginTop: '8px', fontSize: '0.85rem', color: connectionStatus === 'error' ? '#d32f2f' : '#666'}}>
                  <strong>Active:</strong> {connectionStatus === 'error' ? 'None (error loading sheet)' : sheetName || (() => {
                    // Extract Google Sheets ID as fallback
                    const editMatch = customUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
                    if (editMatch) {
                      const id = editMatch[1]
                      return `Google Sheet (${id.substring(0, 8)}...)`
                    }
                    return customUrl.length > 60 ? customUrl.substring(0, 60) + '...' : customUrl
                  })()}
                </div>
              )}
              
              {(connectionStatus === 'offline' || connectionStatus === 'error') && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px',
                  background: '#ffebee',
                  border: '1px solid #ef5350',
                  borderRadius: '4px',
                  color: '#c62828',
                  fontSize: '0.85rem'
                }}>
                  <strong style={{display: 'block', marginBottom: '4px'}}>⚠️ Error:</strong>
                  {fetchError || 'Connection issue'}
                  {lastSuccessfulFetch && (
                    <div style={{marginTop: '6px', fontSize: '0.8rem', opacity: 0.8}}>
                      Last successful update: {lastFetchDateTimeDisplay}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div style={{paddingTop: '12px', borderTop: '1px solid #ddd'}}>
              <label style={{fontWeight: 500, display: 'block', marginBottom: '8px'}}>
                Stale data warning (minutes)
              </label>
              <div style={{display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={staleThresholdMinutes}
                  onChange={e => {
                    const raw = Number(e.target.value)
                    if (Number.isNaN(raw)) return
                    const clamped = Math.max(1, Math.min(120, Math.round(raw)))
                    setStaleThresholdMinutes(clamped)
                  }}
                  style={{padding: '6px 8px', width: '80px'}}
                />
                <button
                  type="button"
                  onClick={() => setStaleThresholdMinutes(DEFAULT_STALE_THRESHOLD_MINUTES)}
                  disabled={staleThresholdMinutes === DEFAULT_STALE_THRESHOLD_MINUTES}
                  style={{padding: '6px 12px'}}
                >
                  Reset
                </button>
                <span style={{fontSize: '0.8rem', color: '#666'}}>
                  Warning triggers after {staleThresholdLabel} without updates.
                </span>
              </div>
            </div>

            <div style={{paddingTop: '12px', borderTop: '1px solid #ddd'}}>
              <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={autoScrollEnabled}
                  onChange={e => setAutoScrollEnabled(e.target.checked)}
                />
                <span style={{fontWeight: 500}}>Auto-scroll to current session</span>
              </label>
            </div>
          </div>
        </div>
      )}
      
      {/* Content Section - Contains session list and run groups */}
      <div className="content" style={{
        flex: showDebugPanel ? 'none' : 1, // Don't flex-fill when debug panel is open
        minHeight: showDebugPanel ? '600px' : 0, // Fixed min height when debug panel is open
        overflow: 'visible', // Let panel shadows render without clipping
        flexDirection: isMobile ? 'column' : undefined,
        gap: isMobile ? '16px' : undefined
      }}>
        {isMobile ? (
          <section
            className={`mobile-current-card${mobileCurrentExpanded ? ' expanded' : ''}`}
            style={{alignSelf: 'stretch'}}
            role="button"
            tabIndex={0}
            aria-expanded={mobileCurrentExpanded}
            onClick={() => setMobileCurrentExpanded(prev => !prev)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.currentTarget.click()
              }
            }}
          >
            <div className="mobile-card-header">
              <div className="mobile-card-label">Current Session</div>
              <div className="mobile-card-toggle">
                {mobileCurrentExpanded ? 'Hide upcoming' : 'Show upcoming'}
              </div>
            </div>

            {mobilePrimarySession ? (
              <div className="mobile-card-body">
                <div className="mobile-card-line" title={mobilePrimarySession.session}>
                  <span className="mobile-card-title">{mobilePrimarySession.session}</span>
                  <span className="mobile-card-time">
                    &nbsp;—&nbsp;
                    {mobilePrimarySession.start ? formatTimeWithAmPm(mobilePrimarySession.start) : 'TBD'}
                  </span>
                </div>
                {mobileSessionEndStatus && (
                  <div className="mobile-session-status">
                    {mobileSessionEndStatus.showPrefix
                      ? `Ends in ${mobileSessionEndStatus.text}`
                      : mobileSessionEndStatus.text}
                  </div>
                )}
              </div>
            ) : (
              <div className="mobile-card-body">
                <div className="mobile-card-title">No session on track</div>
                <div className="mobile-session-status">Check back soon</div>
              </div>
            )}

            {mobileCurrentExpanded && (
              <div className="mobile-upcoming" onClick={event => event.stopPropagation()}>
                <div className="mobile-upcoming-title">Upcoming Sessions</div>
                {mobileUpcomingSessions.length > 0 ? (
                  <div className="mobile-upcoming-list">
                    {mobileUpcomingSessions.map((session, idx) => (
                      <div key={`${session.session}-${idx}`} className="mobile-upcoming-item">
                        <div className="mobile-upcoming-line">
                          <span className="mobile-upcoming-time">
                            {session.start ? formatTimeWithAmPm(session.start) : 'TBD'}
                          </span>
                          <span className="mobile-upcoming-name">{session.session || 'Untitled session'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mobile-upcoming-empty">No upcoming sessions</div>
                )}
              </div>
            )}
          </section>
        ) : (
          <aside className="left" style={{
            padding: panelPadding
          }}>

            <div style={{display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px', justifyContent: 'space-between'}}>
              <h2 style={{margin: 0, fontSize: '1.7rem', color: '#1f2937', fontWeight: 700, letterSpacing: '-0.5px'}}>Sessions</h2>
              <div style={{display: 'flex', alignItems: 'center'}}>
                <select
                  value={selectedDay || ''}
                  onChange={e => setSelectedDay(e.target.value)}
                  style={{padding: '3.5px 7px', fontSize: '0.98rem', borderRadius: '6px', border: '1px solid #d8dee9', background: '#f8fafd', color: '#222', fontWeight: 500}}
                >
                  {availableDays.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="session-list" ref={listRef}>
              {rows.map((r, idx) => {
                const isNow = current && r.start && current.start &&
                             r.start.getTime() === current.start.getTime()
                const end = r.end || addMinutes(r.start, r.duration || 20)
                const status = r.start && end && end < nowWithOffset ? 'past' :
                              isNow ? 'now' : 'future'

                return (
                  <div
                    key={idx}
                    ref={el => (itemRefs.current[idx] = el)}
                    className={`session ${status}`}
                  >
                    <div className="time">{r.start ? formatTimeWithAmPm(r.start) : ''}</div>
                    <div className="title">{r.session}</div>
                    <div className="dur">{r.duration ? `${r.duration}m` : ''}</div>
                  </div>
                )
              })}
            </div>
          </aside>
        )}
        
        {/* Right Side: Run Groups, Meetings, Upcoming */}
        {!isMobile || !mobileCurrentExpanded ? (
          <section className="right" style={{
            padding: panelPadding,
            overflow: isMobile ? 'visible' : 'auto',
            width: isMobile ? '100%' : undefined,
            flex: isMobile ? '1 1 auto' : undefined,
            minHeight: isMobile ? 'calc(var(--vp-dvh, 100dvh) * 0.65)' : undefined
          }}>
          {/* Run Groups Selector */}
          <div style={{paddingTop: '6px', marginBottom: '10px'}}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px'}}>
              <label
                onClick={() => setRunGroupsExpanded(!runGroupsExpanded)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '1.7rem',
                  fontWeight: 700,
                  margin: 0,
                  color: '#1f2937',
                  letterSpacing: '-0.5px',
                  gap: '8px'
                }}
              >
                <span style={{fontSize: '0.7rem'}}>{runGroupsExpanded ? '▼' : '▶'}</span>
                Run Groups
              </label>
            </div>
            {!runGroupsExpanded && selectedGroups.length > 0 && (
              <div style={{fontSize: '0.98rem', color: '#666', fontWeight: 500, marginTop: '6px', marginLeft: '2px'}}>
                {selectedGroups.join(', ')}
              </div>
            )}
          </div>
          
          {runGroupsExpanded && (
            <div className="controls" style={{padding: '16px 20px', marginBottom: '20px'}}>
              <div className="checkbox-group">
                {groups.map(g => (
                  <label key={g} className="checkbox-label" style={{fontSize: '1rem', padding: '4px 8px'}}>
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g)}
                      onChange={() => handleGroupToggle(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
          )}
          
          {/* Upcoming Sessions */}
          {upcomingCount > 0 && (
            <>
              {/* Activities */}
              <div style={{marginBottom: '16px'}}>
                {relevantActivities.map((activity, idx) => {
                  const isFuture = activity.start && nowWithOffset <= addMinutes(activity.start, 10)
                  if (!isFuture) return null
                  return (
                    <div 
                      key={idx}
                      className="meeting"
                      style={{
                        padding: isCompactMode ? '6px 8px' : undefined,
                        fontSize: isCompactMode ? '0.85rem' : undefined,
                        marginTop: isCompactMode ? '4px' : undefined
                      }}
                    >
                      <div style={{fontSize: isCompactMode ? '0.9rem' : undefined}}>
                        {activity.title} — {activity.start ? formatTimeWithAmPm(activity.start) : 'TBD'}
                      </div>
                      <div 
                        className="countdown" 
                        style={{
                          fontSize: isCompactMode ? '0.8rem' : undefined,
                          marginTop: isCompactMode ? '2px' : undefined
                        }}
                      >
                        Starts in {formatTimeUntil(activity.start - nowWithOffset, activity, nowWithOffset)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="next-group-container">
                {Object.entries(nextSessionsByGroup)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([group, session]) => {
                    const padding = upcomingCount === 1 ? '1.4rem 1.8rem' : 
                                   upcomingCount === 2 ? '1.1rem 1.4rem' : 
                                   upcomingCount === 3 ? '0.9rem 1.1rem' : '0.7rem 0.9rem'
                    const fontSize = upcomingCount === 1 ? '1.1rem' : 
                                    upcomingCount === 2 ? '1.05rem' : 
                                    upcomingCount === 3 ? '1rem' : '0.95rem'
                    const strongSize = upcomingCount === 1 ? '1.2rem' : 
                                      upcomingCount === 2 ? '1.15rem' : 
                                      upcomingCount === 3 ? '1.1rem' : '1.05rem'
                    const startsInMs = session && session.start ? (session.start.getTime() - nowWithOffset.getTime()) : null
                    const isSoon = startsInMs !== null && startsInMs > 0 && startsInMs <= 30 * 60000
                    return (
                      <div key={group} className={`next-for-block${isSoon ? ' soon' : ''}`} style={{padding, fontSize}}>
                        {session ? (
                          <>
                            <div>
                              <strong style={{fontSize: strongSize}}>{session.session}</strong> — {formatTimeWithAmPm(session.start)}
                            </div>
                            <div className="countdown">
                              Starts in {formatTimeUntil(session.start - nowWithOffset, session, nowWithOffset)}
                            </div>
                          </>
                        ) : (
                          <div>
                            <strong style={{fontSize: strongSize}}>{group}</strong>: None scheduled
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </>
          )}
          </section>
        ) : null}
      </div>
      </div>
    </div>
  )
}




