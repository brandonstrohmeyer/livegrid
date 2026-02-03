import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { firestore, ensureFirestorePersistence } from '../firebaseClient'
import { useAuth } from './AuthContext'

const LOCAL_STORAGE_KEY = 'nasaDashboardPrefs'
const legacyKeys = {
  customUrl: 'nasaScheduleUrl',
  autoScrollEnabled: 'nasaAutoScroll',
  staleThresholdMinutes: 'nasaStaleThresholdMinutes'
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readLegacyPrefs() {
  if (!canUseStorage()) return {}
  const prefs = {}
  const schedule = window.localStorage.getItem(legacyKeys.customUrl)
  if (schedule) prefs.customUrl = schedule
  const autoScroll = window.localStorage.getItem(legacyKeys.autoScrollEnabled)
  if (autoScroll !== null) prefs.autoScrollEnabled = autoScroll === 'true'
  const stale = window.localStorage.getItem(legacyKeys.staleThresholdMinutes)
  if (stale !== null && !Number.isNaN(parseInt(stale, 10))) {
    prefs.staleThresholdMinutes = parseInt(stale, 10)
  }
  return prefs
}

function readLocalPrefs() {
  if (!canUseStorage()) return {}
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw)
    }
  } catch (err) {
    console.warn('[prefs] Failed to parse local prefs', err)
  }
  const legacy = readLegacyPrefs()
  if (Object.keys(legacy).length) {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(legacy))
    } catch (err) {
      console.warn('[prefs] Failed to migrate legacy prefs', err)
    }
  }
  return legacy
}

function writeLocalPrefs(prefs) {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs))
  } catch (err) {
    console.warn('[prefs] Unable to persist local prefs', err)
  }
}

const PreferencesContext = createContext({
  prefs: {},
  loading: false,
  syncSource: 'local',
  updatePreference: () => {}
})

const generateClientId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `client_${Math.random().toString(36).slice(2, 10)}`
}

export function PreferencesProvider({ children }) {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(() => readLocalPrefs())
  const [loading, setLoading] = useState(false)
  const [syncSource, setSyncSource] = useState('local')
  const unsubscribeRef = useRef(null)
  const pendingWriteRef = useRef(null)
  const flushTimerRef = useRef(null)
  const clientIdRef = useRef(generateClientId())

  const clearPendingTimer = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }

  const queueRemoteWrite = useCallback(
    nextPrefs => {
      if (!user || !firestore) return
      pendingWriteRef.current = nextPrefs
      if (flushTimerRef.current) return
      flushTimerRef.current = setTimeout(async () => {
        const payload = pendingWriteRef.current
        pendingWriteRef.current = null
        flushTimerRef.current = null
        if (!payload) return
        try {
          const docRef = doc(firestore, 'users', user.uid)
          await setDoc(
            docRef,
            {
              prefs: payload,
              updatedAt: serverTimestamp(),
              lastClient: clientIdRef.current
            },
            { merge: true }
          )
        } catch (err) {
          console.error('[prefs] Failed to sync to Firestore', err)
        }
      }, 350)
    },
    [user, firestore]
  )

  useEffect(() => () => clearPendingTimer(), [])

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }

    if (!user || !firestore) {
      setSyncSource('local')
      const local = readLocalPrefs()
      setPrefs(local)
      setLoading(false)
      return undefined
    }

    setSyncSource('cloud')
    setLoading(true)
    ensureFirestorePersistence()

    const docRef = doc(firestore, 'users', user.uid)
    unsubscribeRef.current = onSnapshot(
      docRef,
      snapshot => {
        if (!snapshot.exists()) {
          const local = readLocalPrefs()
          setPrefs(local)
          setLoading(false)
          setDoc(
            docRef,
            {
              prefs: local,
              createdAt: serverTimestamp(),
              lastClient: clientIdRef.current
            },
            { merge: true }
          ).catch(err => console.error('[prefs] Failed to seed Firestore doc', err))
          return
        }
        const data = snapshot.data() || {}
        setPrefs(data.prefs || {})
        setLoading(false)
      },
      err => {
        console.error('[prefs] Snapshot error', err)
        setLoading(false)
      }
    )

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [user, firestore])

  const updatePreference = useCallback(
    (key, valueOrUpdater, defaultValue) => {
      setPrefs(prev => {
        const previous = Object.prototype.hasOwnProperty.call(prev, key) ? prev[key] : defaultValue
        const nextValue = typeof valueOrUpdater === 'function' ? valueOrUpdater(previous) : valueOrUpdater
        if (Object.is(previous, nextValue)) {
          return prev
        }
        const nextPrefs = { ...prev }
        if (typeof nextValue === 'undefined') {
          delete nextPrefs[key]
        } else {
          nextPrefs[key] = nextValue
        }
        if (!user || !firestore) {
          writeLocalPrefs(nextPrefs)
        } else {
          queueRemoteWrite(nextPrefs)
        }
        return nextPrefs
      })
    },
    [queueRemoteWrite, user, firestore]
  )

  const value = useMemo(
    () => ({
      prefs,
      loading,
      syncSource,
      updatePreference
    }),
    [prefs, loading, syncSource, updatePreference]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  return useContext(PreferencesContext)
}

export function useSyncedPreference(key, defaultValue) {
  const { prefs, updatePreference, loading } = usePreferences()
  const defaultRef = useRef()
  if (defaultRef.current === undefined) {
    defaultRef.current = typeof defaultValue === 'function' ? defaultValue() : defaultValue
  }
  const value = Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : defaultRef.current
  const setter = useCallback(
    valueOrUpdater => {
      updatePreference(key, valueOrUpdater, defaultRef.current)
    },
    [key, updatePreference]
  )

  return [value, setter, loading]
}
