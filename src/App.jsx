import React, { useEffect, useState, useMemo, useRef } from 'react'
import version from './version.js'
import Papa from 'papaparse'
import { Sidebar, Menu, MenuItem } from 'react-pro-sidebar'
import { MdFullscreen, MdFullscreenExit, MdSettings, MdBuild, MdPlayArrow, MdWarning } from 'react-icons/md'
import { FaInstagram } from 'react-icons/fa'
import {
  parseTimeToToday,
  addMinutes,
  isTimeRow,
  isOnTrackSession,
  getSessionPriority,
  deduplicateSessions,
  shouldExcludeFromRunGroups,
  extractRunGroups,
  fixSessionNameTypos
} from './scheduleUtils.js'

const DEFAULT_STALE_THRESHOLD_MINUTES = 5

function getDateWithOffsets(date, clockOffset = 0, dayOffset = 0) {
  if (!date) return null
  const offsetMs = clockOffset * 60000 + dayOffset * 86400000
  return new Date(date.getTime() + offsetMs)
}

// ============================================================================
// MEETING EXTRACTION - Find relevant meetings for selected groups
// ============================================================================

/**
 * Find meetings relevant to the selected run groups
 */
function findRelevantMeetings(allRows, selectedDay, selectedGroups, dayOffset = 0) {
  if (selectedGroups.includes('All') || selectedGroups.length === 0) return []
  
  const meetings = []
  
  // HPDE Meeting
  const hasHPDE = selectedGroups.some(g => g.includes('HPDE'))
  if (hasHPDE) {
    const hpdeMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.session || '').toLowerCase().includes('hpde meeting')
    )
    if (hpdeMeeting) {
      meetings.push({ session: hpdeMeeting.session, start: hpdeMeeting.start })
    }
  }
  
  // TT Drivers Meeting
  const hasTT = selectedGroups.some(g => g.includes('TT'))
  if (hasTT) {
    const ttMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.note || '').toLowerCase().includes('tt drivers')
    )
    if (ttMeeting) {
      const timeMatch = ttMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)
      const timeStr = timeMatch ? timeMatch[1].trim() : null
      let start = timeStr ? parseTimeToToday(timeStr) : null
      // Apply day offset to meeting time
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      meetings.push({ session: 'TT Drivers Meeting', customTime: timeStr, start })
    }
  }
  
  // All Racers Meeting
  const hasRace = selectedGroups.some(g => 
    ['Thunder Race', 'Lightning Race', 'Mock Race'].includes(g)
  )
  if (hasRace) {
    const racersMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.note || '').toLowerCase().includes('all racers meeting')
    )
    if (racersMeeting) {
      const timeMatch = racersMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)
      const timeStr = timeMatch ? timeMatch[1].trim() : null
      let start = timeStr ? parseTimeToToday(timeStr) : null
      // Apply day offset to meeting time
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      meetings.push({ session: 'All Racers Meeting', customTime: timeStr, start })
    }
  }
  
  return meetings
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
function sessionMatchesGroup(sessionName, group) {
  const lowerSession = (sessionName || '').toLowerCase()
  const lowerGroup = group.toLowerCase()
  
  // TT ALL and TT Drivers match both TT Alpha and TT Omega
  if (/tt\s+all|tt\s+drivers/i.test(sessionName)) {
    return lowerGroup.includes('tt alpha') || lowerGroup.includes('tt omega')
  }
  
  // For HPDE groups, extract all numbers from session name and check if group number is in there
  // This handles "HPDE 3* & 4" matching both "HPDE 3" and "HPDE 4"
  if (/hpde\s*\d/i.test(lowerGroup)) {
    const groupNumber = lowerGroup.match(/\d+/)?.[0]
    if (groupNumber && /hpde/i.test(lowerSession)) {
      // Extract all numbers from the session name (after HPDE or standalone digits in combined sessions)
      const allNumbers = lowerSession.match(/\d+/g) || []
      return allNumbers.includes(groupNumber)
    }
  }
  
  // For combined sessions with "&" (like "Test/Tune & Comp School")
  // Check if the group matches any part of the combined session
  if (lowerSession.includes('&')) {
    const parts = lowerSession.split('&').map(p => p.trim())
    return parts.some(part => part.includes(lowerGroup) || lowerGroup.includes(part))
  }
  
  return lowerSession.includes(lowerGroup)
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
    selectedGroups.some(group => sessionMatchesGroup(session.session, group))
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
  return (
    <>
      {hours}:{mins}
      <span style={{fontSize: '0.55em', verticalAlign: 'baseline', marginLeft: '0.1em'}}>
        {ampm}
      </span>
    </>
  )
}

/**
 * Format countdown timer (e.g., "2h 15m" or "45m")
 * Shows "now" if session is currently active
 */
function formatTimeUntil(milliseconds, session, nowWithOffset) {
  if (milliseconds <= 0 && session) {
    // Check if we're within the session window
    const end = session.end || addMinutes(session.start, session.duration || 20)
    if (nowWithOffset >= session.start && nowWithOffset < end) {
      return 'now'
    }
    return '0m'
  }
  
  const totalMinutes = Math.ceil(milliseconds / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
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
  
  // State management - initialize with demo values if URL param is set
  const [rows, setRows] = useState([])
  const [allRows, setAllRows] = useState([])
  const [clockOffset, setClockOffset] = useState(demoOffsets.clockOffset)
  const [dayOffset, setDayOffset] = useState(demoOffsets.dayOffset)
  const [now, setNow] = useState(new Date())
  const [selectedGroups, setSelectedGroups] = useState(isDemoMode ? ['HPDE 1', 'TT Omega'] : ['All'])
  const [selectedDay, setSelectedDay] = useState(isDemoMode ? 'Saturday' : null)
  const [lastFetch, setLastFetch] = useState(null)
  const [currentDay, setCurrentDay] = useState(null)
  const [availableDays, setAvailableDays] = useState([])
  const [debugMode, setDebugMode] = useState(isDemoMode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [runGroupsExpanded, setRunGroupsExpanded] = useState(false)
  const [selectedCsvFile, setSelectedCsvFile] = useState(isDemoMode ? '2026 New Year, New Gear - Schedule.csv' : 'schedule.csv')
  const [optionsExpanded, setOptionsExpanded] = useState(() => {
    if (isDemoMode) return false
    const savedUrl = localStorage.getItem('nasaScheduleUrl')
    return !savedUrl // Open options if no URL saved
  })
  const [customUrl, setCustomUrl] = useState(() => {
    if (isDemoMode) return ''
    return localStorage.getItem('nasaScheduleUrl') || ''
  })
  const [useCustomUrl, setUseCustomUrl] = useState(true)
  const [sheetName, setSheetName] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('online') // 'online', 'offline', 'error'
  const [lastSuccessfulFetch, setLastSuccessfulFetch] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => {
    const saved = localStorage.getItem('nasaAutoScroll')
    return saved !== null ? saved === 'true' : true
  })
  const [forceShowStaleBanner, setForceShowStaleBanner] = useState(false)
  const [staleThresholdMinutes, setStaleThresholdMinutes] = useState(() => {
    const stored = localStorage.getItem('nasaStaleThresholdMinutes')
    const parsed = stored ? parseInt(stored, 10) : DEFAULT_STALE_THRESHOLD_MINUTES
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_THRESHOLD_MINUTES
  })

  const staleThresholdMs = useMemo(() => Math.max(1, staleThresholdMinutes) * 60000, [staleThresholdMinutes])
  const staleThresholdLabel = useMemo(() => (
    staleThresholdMinutes === 1 ? '1 minute' : `${staleThresholdMinutes} minutes`
  ), [staleThresholdMinutes])

  const isDataStale = useMemo(() => {
    if (!lastSuccessfulFetch) return false
    return now.getTime() - lastSuccessfulFetch.getTime() > staleThresholdMs
  }, [lastSuccessfulFetch, now, staleThresholdMs])
  
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
    setConnectionStatus(navigator.onLine ? 'online' : 'offline')
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  // Reset sheet name when URL changes
  useEffect(() => {
    setSheetName('')
    // Save URL to localStorage
    if (customUrl) {
      localStorage.setItem('nasaScheduleUrl', customUrl)
    } else {
      localStorage.removeItem('nasaScheduleUrl')
    }
  }, [customUrl])
  
  // Save auto-scroll preference to localStorage
  useEffect(() => {
    localStorage.setItem('nasaAutoScroll', autoScrollEnabled.toString())
  }, [autoScrollEnabled])

  // Persist stale threshold preference
  useEffect(() => {
    localStorage.setItem('nasaStaleThresholdMinutes', Math.max(1, staleThresholdMinutes).toString())
  }, [staleThresholdMinutes])
  
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
    if (!lastSuccessfulFetch) return null
    return getDateWithOffsets(lastSuccessfulFetch, clockOffset, dayOffset)
  }, [lastSuccessfulFetch, clockOffset, dayOffset])

  const lastFetchTimeDisplay = lastFetchAdjusted ? lastFetchAdjusted.toLocaleTimeString() : 'Never'
  const lastFetchDateTimeDisplay = lastFetchAdjusted ? lastFetchAdjusted.toLocaleString() : 'Never'
  
  // Fetch and parse schedule
  async function fetchSchedule() {
    // Skip fetch if offline
    if (!navigator.onLine) {
      setConnectionStatus('offline')
      setFetchError('No internet connection')
      return
    }
    
    // Skip fetch if no custom URL provided and not in debug mode
    if (!customUrl && !debugMode) {
      // Clear data when no URL is provided
      setRows([])
      setAllRows([])
      return
    }
    
    try {
      setFetchError(null)
      setConnectionStatus('online')
      let csvPath
      if (customUrl) {
        // Convert Google Sheets edit URL to CSV export URL
        let url = customUrl
        const editMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
        if (editMatch) {
          const spreadsheetId = editMatch[1]
          
          // Fetch sheet name from the HTML page
          if (!sheetName) {
            try {
              const htmlResponse = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`)
              const htmlText = await htmlResponse.text()
              const titleMatch = htmlText.match(/<title>([^<]+)<\/title>/)
              if (titleMatch) {
                const fullTitle = titleMatch[1]
                // Check if it's an error page
                if (fullTitle.includes('Page Not Found') || fullTitle.includes('Error')) {
                  throw new Error('Google Sheet not found or not accessible')
                }
                // Remove " - Google Sheets" suffix if present
                const cleanTitle = fullTitle.replace(/\s*-\s*Google Sheets\s*$/, '')
                setSheetName(cleanTitle)
              }
            } catch (e) {
              console.log('Could not fetch sheet name:', e)
              // Don't set error here, let the CSV fetch fail and handle it
            }
          }
          
          // Extract sheet name from URL if present (gid parameter)
          const gidMatch = url.match(/[#&]gid=(\d+)/)
          if (gidMatch) {
            // If gid is present, we'd need to map it to sheet name, but for now use default
            url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`
          } else {
            // Check if it's already a proper export URL
            if (!url.includes('/export?') && !url.includes('/gviz/tq?')) {
              url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`
            }
          }
        }
        csvPath = url
      } else if (debugMode) {
        // Debug mode: allow local CSV files
        csvPath = selectedCsvFile === 'schedule.csv' ? '/schedule.csv' : `/test-schedules/${selectedCsvFile}`
      } else {
        // No URL and not in debug mode - this shouldn't happen due to early return
        return
      }
      const response = await fetch(csvPath)
      
      // Check if response is ok
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Sheet not found (404). Please check the URL and make sure the sheet is publicly accessible ("Anyone with the link can view"), then try again.')
        }
        throw new Error(`Failed to load sheet (${response.status}): ${response.statusText}`)
      }
      
      const text = await response.text()
      
      // Check if we got HTML error page instead of CSV
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        throw new Error('Received HTML instead of CSV. Sheet may not be publicly accessible.')
      }
      
      const parsed = Papa.parse(text, { skipEmptyLines: true })
      
      // Parse all rows with day context
      const allRows = []
      let currentDay = null
      
      parsed.data.forEach(row => {
        const firstCol = (row[0] || '').toString().trim().toLowerCase()
        
        // Detect day section headers
        if (firstCol.includes('friday')) currentDay = 'Friday'
        else if (firstCol.includes('saturday')) currentDay = 'Saturday'
        else if (firstCol.includes('sunday')) currentDay = 'Sunday'
        
        // Parse time-based rows
        if (isTimeRow(row)) {
          let start = parseTimeToToday(row[0])
          // Adjust start time by day offset so sessions match mocked day
          if (dayOffset !== 0) {
            start = new Date(start.getTime() + dayOffset * 86400000)
          }
          const duration = row[1] && /\d+/.test(row[1]) ? parseInt(row[1], 10) : null
          const end = duration ? addMinutes(start, duration) : null
          
          // Fix common typos in session names
          let sessionName = fixSessionNameTypos((row[2] || '').toString().trim())
          
          // Search for notes across columns (different schedules use different layouts)
          const note = (row[4] || row[5] || '').toString().trim()
          
          allRows.push({
            raw: row,
            start,
            duration,
            end,
            session: sessionName,
            note,
            classroomCell: (row[3] || '').toString().trim(),
            day: currentDay
          })
        }
      })
      
      // Sort by start time
      allRows.sort((a, b) => (a.start && b.start ? a.start - b.start : 0))
      
      // Extract available days
      const days = [...new Set(allRows.filter(r => r.day).map(r => r.day))]
      setAvailableDays(days)
      
      // Auto-select day based on current/mocked time (only if no day is currently selected or if auto-scroll is enabled)
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const todayName = dayNames[nowWithOffset.getDay()]
      const defaultDay = days.includes(todayName) ? todayName : days[0]
      
      // Only auto-select day if: no day selected yet, or auto-scroll is enabled (user wants automatic updates)
      if (!selectedDay || autoScrollEnabled) {
        setSelectedDay(defaultDay)
      } else if (selectedDay && !days.includes(selectedDay)) {
        // If user's selected day doesn't exist in new data, fall back to default
        setSelectedDay(defaultDay)
      }
      
      // Filter and deduplicate sessions for the currently selected (or default) day
      const targetDay = selectedDay && days.includes(selectedDay) ? selectedDay : defaultDay
      const dayRows = allRows.filter(r => r.day === targetDay)
      const onTrackRows = dayRows.filter(isOnTrackSession)
      const filteredRows = deduplicateSessions(onTrackRows)
      
      setAllRows(allRows)
      setRows(filteredRows)
      setCurrentDay(filteredRows.length > 0 ? filteredRows[0].day : null)
      setLastFetch(new Date())
      setLastSuccessfulFetch(new Date())
      setConnectionStatus('online')
      setFetchError(null)
      
      // Auto-collapse options panel after successful fetch (only if no errors)
      if (customUrl && optionsExpanded) {
        setOptionsExpanded(false)
      }
    } catch (error) {
      console.error('Failed to fetch or parse schedule:', error)
      setConnectionStatus('error')
      
      // Determine error type
      if (!navigator.onLine) {
        setFetchError('No internet connection')
      } else if (error.message && error.message.includes('Failed to fetch')) {
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
    fetchSchedule()
    const timer = setInterval(fetchSchedule, 30000)
    return () => clearInterval(timer)
  }, [dayOffset, selectedCsvFile, customUrl, debugMode])
  
  // Update displayed rows when selected day changes
  useEffect(() => {
    if (!selectedDay || allRows.length === 0) return
    
    const dayRows = allRows.filter(r => r.day === selectedDay)
    const onTrackRows = dayRows.filter(isOnTrackSession)
    const filteredRows = deduplicateSessions(onTrackRows)
    
    setRows(filteredRows)
    setCurrentDay(selectedDay)
  }, [selectedDay, allRows])
  
  // Extract run groups from current sessions
  const groups = useMemo(() => extractRunGroups(rows), [rows])
  
  // Find current and upcoming sessions
  const current = useMemo(() => findCurrentSession(rows, nowWithOffset), [rows, nowWithOffset])
  const relevantMeetings = useMemo(() => 
    findRelevantMeetings(allRows, selectedDay, selectedGroups, dayOffset),
    [allRows, selectedDay, selectedGroups, dayOffset]
  )
  const nextSessionsByGroup = useMemo(() => 
    findNextSessionsPerGroup(rows, selectedGroups, nowWithOffset),
    [rows, selectedGroups, nowWithOffset]
  )
  
  // Auto-scroll to current session
  useEffect(() => {
    if (!current || !autoScrollEnabled) return
    
    const idx = rows.findIndex(r => 
      r.start && current.start && r.start.getTime() === current.start.getTime()
    )
    if (idx === -1) return
    
    const element = itemRefs.current[idx]
    if (element && listRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    
    // Re-center after 30 seconds
    const timer = setTimeout(() => {
      if (element && listRef.current && autoScrollEnabled) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 30000)
    
    return () => clearTimeout(timer)
  }, [current, rows, autoScrollEnabled])
  
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
  
  // Dynamic sizing based on content density
  const upcomingCount = Object.entries(nextSessionsByGroup).length
  const isCompactMode = upcomingCount > 3
  
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* React Pro Sidebar */}
      <Sidebar
        collapsed={!sidebarOpen}
        width="280px"
        collapsedWidth="60px"
        backgroundColor="#f8f9fa"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 1000,
          border: 'none',
          borderRight: '1px solid #e5e7eb',
          height: '100vh'
        }}
      >
        <div style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column'
        }}>
        {/* Sidebar Header */}
        <div style={{
          padding: '20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarOpen ? 'space-between' : 'center',
          borderBottom: '1px solid #e5e7eb',
          background: '#ffffff'
        }}>
          {sidebarOpen && (
            <span style={{color: '#1f2937', fontWeight: 600, fontSize: '1.1rem'}}>Menu</span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: '#f8f9fa',
              border: '1px solid #e5e7eb',
              color: '#1f2937',
              padding: '8px',
              cursor: 'pointer',
              borderRadius: '8px',
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.target.style.background = '#e5e7eb'; e.target.style.transform = 'scale(1.05)'; }}
            onMouseLeave={(e) => { e.target.style.background = '#f8f9fa'; e.target.style.transform = 'scale(1)'; }}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Menu Items */}
        <Menu
          menuItemStyles={{
            button: {
              '&:hover': {
                backgroundColor: '#e0e7ff',
                color: '#3730a3'
              },
              padding: '12px 16px',
              margin: '8px',
              transition: 'background 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              color: '#6b7280'
            },
            icon: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '24px',
              margin: sidebarOpen ? '0' : '0 auto',
              color: '#6b7280'
            }
          }}
        >
          {/* Fullscreen */}
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

          {/* Settings */}
          <MenuItem
            icon={<MdSettings size={20} />}
            onClick={() => setOptionsExpanded(!optionsExpanded)}
          >
            Settings
          </MenuItem>

          {/* Demo */}
          <MenuItem
            icon={<MdPlayArrow size={20} />}
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
          >
            Demo
          </MenuItem>
        </Menu>

        {/* Active Sheet Info */}
        {sidebarOpen && sheetName && (
          <div style={{
            margin: '24px 8px 16px 8px',
            padding: '12px',
            background: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            borderLeft: '3px solid #3b82f6'
          }}>
            <div style={{color: '#6b7280', fontSize: '0.75rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Active Sheet</div>
            <div style={{color: '#1f2937', fontSize: '0.9rem', wordBreak: 'break-word'}}>{sheetName}</div>
          </div>
        )}

        {/* Spacer to push Debug to bottom */}
        <div style={{flex: 1}} />

        {/* Debug at bottom */}
        <Menu
          menuItemStyles={{
            button: {
              '&:hover': {
                backgroundColor: '#e0e7ff',
                color: '#3730a3'
              },
              padding: '12px 16px',
              margin: '8px',
              transition: 'background 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              color: '#6b7280'
            },
            icon: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '24px',
              margin: sidebarOpen ? '0' : '0 auto',
              color: '#6b7280'
            }
          }}
        >
          <MenuItem
            icon={<MdBuild size={20} />}
            onClick={() => setShowDebugPanel(!showDebugPanel)}
          >
            Debug
          </MenuItem>
        </Menu>

        {/* Build Number & Instagram */}
        <div style={{
          padding: '10px 16px',
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
      </Sidebar>

      {/* Main Content Wrapper - Controls viewport filling */}
      <div style={{
        marginLeft: sidebarOpen ? '280px' : '60px',
        transition: 'margin-left 0.3s ease',
        flex: 1,
        padding: sidebarOpen ? '16px 48px' : '16px 48px 24px 64px',
        backgroundColor: '#ffffff',
        minHeight: '100vh',
        height: showDebugPanel ? 'auto' : '100vh', // Auto height when debug panel is open
        overflow: showDebugPanel ? 'visible' : 'hidden', // Allow overflow when debug panel is open
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}>
      {/* Header with Clock and Info Panel */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '20px', width: '100%'}}>
        {/* Clock Display */}
        <div style={{flex: '0 0 42%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
          <h1 className="clock" style={{margin: 0, whiteSpace: 'nowrap'}}>
            {(() => {
              const hours = nowWithOffset.getHours() % 12 || 12
              const mins = String(nowWithOffset.getMinutes()).padStart(2, '0')
              const secs = String(nowWithOffset.getSeconds()).padStart(2, '0')
              const ampm = nowWithOffset.getHours() >= 12 ? 'PM' : 'AM'
              return <>{hours}:{mins}:{secs}<span className="clock-ampm">{ampm}</span></>
            })()}
          </h1>
        </div>
        
        {/* Info Panel */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <div style={{
            width: '20%',
            minWidth: '220px',
            maxWidth: '260px',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '0.85rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
          }}>
          {/* Connection Status */}
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
              backgroundColor: isDataStale
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
                {isDataStale
                  ? 'Data Stale'
                  : connectionStatus === 'online'
                    ? 'Connected'
                    : connectionStatus === 'offline'
                      ? 'Disconnected'
                      : 'Connecting...'}
              </div>
              <div style={{color: '#6b7280', fontSize: '0.7rem', marginTop: '2px'}}>
                Last fetch: {lastFetchTimeDisplay}
                {connectionStatus !== 'online' && lastSuccessfulFetch && ' (retrying...)'}
              </div>
            </div>
          </div>
          
          {/* Active Schedule */}
          {sheetName && (
            <div>
              <div style={{color: '#6b7280', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px'}}>Schedule</div>
              <div style={{color: '#1f2937', fontSize: '0.8rem', lineHeight: '1.3'}}>{sheetName}</div>
            </div>
          )}
          </div>
        </div>
      </div>
      
      {/* Stale Data Warning Banner */}
      {(() => {
        if (!isDataStale && !forceShowStaleBanner) return null

        return (
          <div style={{
            margin: '0 20px 20px 20px',
            padding: '10px 16px',
            background: '#ffebee',
            border: '1px solid #ef5350',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 2px 4px rgba(239, 83, 80, 0.1)'
          }}>
            <MdWarning size={24} style={{color: '#ef5350', flexShrink: 0}} />
            <div style={{flex: 1}}>
              <div style={{color: '#c62828', fontWeight: 600, fontSize: '0.95rem'}}>
                Data Refresh Failed
              </div>
              <div style={{color: '#d32f2f', fontSize: '0.85rem', marginTop: '2px'}}>
                Unable to refresh data for more than {staleThresholdLabel}. Last update: {lastFetchDateTimeDisplay}
              </div>
            </div>
          </div>
        )
      })()}
      
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
            {customUrl && (
              <>
                Sheet Name: {sheetName || 'Loading...'}<br/>
                Sheet URL: <span style={{fontSize: '0.8rem', wordBreak: 'break-all', fontFamily: 'monospace'}}>{customUrl}</span><br/>
              </>
            )}
            {!customUrl && debugMode && (
              <>Local File: {selectedCsvFile}<br/></>
            )}
            Total Sessions (all days): {allRows.length}<br/>
            Sessions (selected day): {rows.length}<br/>
            Run Groups: {groups.join(', ') || 'None'}<br/>
            Selected Groups: {selectedGroups.join(', ')}<br/>
            Meetings Found: {relevantMeetings.length}<br/>
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
              <option value="2024 Santa's Toy Run - Schedule.csv">2024 Santa's Toy Run</option>
              <option value="2024 Savannah Sizzler - Schedule.csv">2024 Savannah Sizzler</option>
              <option value="2025 Brady Skelebration - Schedule.csv">2025 Brady Skelebration</option>
              <option value="2025 Flatten The Curve - Schedule.csv">2025 Flatten The Curve</option>
              <option value="2025 Santa's Toy Run - Schedule.csv">2025 Santa's Toy Run</option>
              <option value="2025 Sinko De Mayo - Schedule.csv">2025 Sinko De Mayo</option>
              <option value="2025 Spring Brake - Schedule.csv">2025 Spring Brake</option>
              <option value="2025 Winter Meltdown - Schedule.csv">2025 Winter Meltdown</option>
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
                value={clockOffset}
                onChange={e => setClockOffset(Number(e.target.value))}
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
                value={dayOffset}
                onChange={e => setDayOffset(Number(e.target.value))}
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
        </div>
      )}
      
      {/* Options Controls */}
      {optionsExpanded && (
        <div style={{marginBottom: '24px', padding: '20px', background: '#f8f9fa', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'}}>
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
            <div>
              {!customUrl && (
                <div style={{
                  padding: '12px',
                  background: '#e3f2fd',
                  border: '2px solid #2196f3',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  fontSize: '0.95rem',
                  color: '#1565c0'
                }}>
                  <strong>Getting Started:</strong> Enter the NASA SE Live Schedule link below to load the weekend schedule.
                </div>
              )}
              
              <label style={{display: 'block', marginBottom: '8px', fontWeight: 500}}>
                Google Sheets URL:
              </label>
              
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
              <div style={{marginTop: '4px', fontSize: '0.8rem', color: '#666', fontStyle: 'italic'}}>
                Tip: Paste any Google Sheets URL - it will automatically convert to CSV format
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
        overflow: showDebugPanel ? 'visible' : 'hidden' // Allow overflow when debug panel is open
      }}>
        {/* Left Side: Session List */}
        <aside className="left" style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <h2 style={{margin: 0, marginBottom: '16px', fontSize: '1.8rem', color: '#1f2937'}}>Sessions</h2>
          
          <div style={{display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px'}}>
            <label style={{fontWeight: 600, color: '#4b5563'}}>Day:</label>
            <select 
              value={selectedDay || ''} 
              onChange={e => setSelectedDay(e.target.value)} 
              style={{padding: '6px 8px', fontSize: '1rem'}}
            >
              {availableDays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
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
        
        {/* Right Side: Run Groups, Meetings, Upcoming */}
        <section className="right" style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          boxSizing: 'border-box',
          overflow: 'auto'
        }}>
          {/* Run Groups Selector */}
          <div style={{marginBottom: '0px'}}>
            <label 
              onClick={() => setRunGroupsExpanded(!runGroupsExpanded)}
              style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.8rem', fontWeight: 700, margin: 0, color: '#1f2937'}}
            >
              <span style={{fontSize: '0.7rem'}}>{runGroupsExpanded ? '▼' : '▶'}</span>
              Run Groups
            </label>
            {!runGroupsExpanded && selectedGroups.length > 0 && (
              <div style={{marginTop: '8px', fontSize: '0.95rem', color: '#666', fontWeight: 500}}>
                {selectedGroups.join(', ')}
              </div>
            )}
          </div>
          
          {runGroupsExpanded && (
            <div className="controls" style={{padding: '16px 20px', marginBottom: '20px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #e5e7eb'}}>
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
              <h3 style={{
                marginTop: '12px',
                paddingTop: '0px',
                marginBottom: '0px',
                fontSize: isCompactMode ? '1.1rem' : '1.3rem',
                paddingBottom: '12px',
                borderBottom: '1px solid #e5e7eb'
              }}>
                Upcoming
              </h3>
              
              {/* Meetings */}
              <div style={{marginBottom: '16px'}}>
              {relevantMeetings.map((meeting, idx) => {
                const isFuture = meeting.start && nowWithOffset <= addMinutes(meeting.start, 10)
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
                      {meeting.session} — {meeting.start ? formatTimeWithAmPm(meeting.start) : meeting.customTime}
                    </div>
                    <div 
                      className="countdown" 
                      style={{
                        fontSize: isCompactMode ? '0.8rem' : undefined,
                        marginTop: isCompactMode ? '2px' : undefined
                      }}
                    >
                      Starts in {formatTimeUntil(meeting.start - nowWithOffset, meeting, nowWithOffset)}
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
                    
                    return (
                      <div key={group} className="next-for-block" style={{padding, fontSize}}>
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
      </div>
      </div>
    </div>
  )
}
