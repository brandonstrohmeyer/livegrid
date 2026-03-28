import version from './version.js'

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}

const TELEMETRY_ENDPOINT = '/api/client-telemetry'
const VISITOR_ID_STORAGE_KEY = 'livegridVisitorId'
const SESSION_ID_STORAGE_KEY = 'livegridSessionId'
const OPEN_REPORTED_STORAGE_KEY = 'livegridTelemetryOpened'
const EVENT_SELECTED_REPORTED_STORAGE_KEY = 'livegridTelemetryEventSelected'
const FINGERPRINT_STORAGE_KEY = 'livegridTelemetryFingerprints'
const HEARTBEAT_INTERVAL_MS = 60 * 1000
const MAX_ERROR_MESSAGE_LENGTH = 240
const MAX_PATH_LENGTH = 160
const MAX_META_VALUE_LENGTH = 120
const MAX_PAYLOAD_BYTES = 4096
const TELEMETRY_TIMEOUT_MS = 4000

let globalHandlersInstalled = false
let heartbeatCleanup = null

function isBrowser() {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

function shouldSendTelemetry() {
  return Boolean(env.PROD) && env.MODE !== 'test' && isBrowser()
}

function safeStorage(kind) {
  if (!isBrowser()) return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch (err) {
    return null
  }
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function ensureStoredId(key, kind = 'local') {
  const storage = safeStorage(kind)
  if (!storage) return randomId()
  const existing = storage.getItem(key)
  if (existing) return existing
  const created = randomId()
  storage.setItem(key, created)
  return created
}

export function getVisitorId() {
  return ensureStoredId(VISITOR_ID_STORAGE_KEY, 'local')
}

export function getSessionId() {
  return ensureStoredId(SESSION_ID_STORAGE_KEY, 'session')
}

function clampString(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

function normalizeError(error) {
  if (!error) return undefined
  if (typeof error === 'string') {
    return { message: clampString(error, MAX_ERROR_MESSAGE_LENGTH) || 'Unknown error' }
  }
  if (error instanceof Error) {
    return {
      message: clampString(error.message, MAX_ERROR_MESSAGE_LENGTH) || 'Unknown error',
      name: clampString(error.name, 80),
      code: typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code).slice(0, 60) : undefined
    }
  }
  if (typeof error === 'object') {
    return {
      message: clampString(error.message, MAX_ERROR_MESSAGE_LENGTH) || 'Unknown error',
      name: clampString(error.name, 80),
      code: typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code).slice(0, 60) : undefined
    }
  }
  return {
    message: clampString(String(error), MAX_ERROR_MESSAGE_LENGTH) || 'Unknown error'
  }
}

function normalizeMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return undefined
  const normalized = {}
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const joined = clampString(value.map(item => String(item)).join(','), MAX_META_VALUE_LENGTH)
      if (joined) normalized[key] = joined
      continue
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      normalized[key] = value
      continue
    }
    const text = clampString(String(value), MAX_META_VALUE_LENGTH)
    if (text) normalized[key] = text
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function currentPathname() {
  if (!isBrowser()) return '/'
  const path = `${window.location.pathname || '/'}${window.location.search || ''}`
  return clampString(path, MAX_PATH_LENGTH) || '/'
}

function buildFingerprint({ event, path, message, check, interactionType }) {
  return [event, path, message || '', check || '', interactionType || ''].join('::')
}

function rememberFingerprint(fingerprint) {
  const storage = safeStorage('session')
  if (!storage || !fingerprint) return false
  try {
    const raw = storage.getItem(FINGERPRINT_STORAGE_KEY)
    const known = raw ? JSON.parse(raw) : []
    if (Array.isArray(known) && known.includes(fingerprint)) {
      return true
    }
    const next = Array.isArray(known) ? [...known, fingerprint] : [fingerprint]
    storage.setItem(FINGERPRINT_STORAGE_KEY, JSON.stringify(next.slice(-100)))
    return false
  } catch (err) {
    return false
  }
}

function sessionFlag(storageKey) {
  const storage = safeStorage('session')
  if (!storage) return false
  return storage.getItem(storageKey) === '1'
}

function markSessionFlag(storageKey) {
  const storage = safeStorage('session')
  if (!storage) return
  storage.setItem(storageKey, '1')
}

function sendPayload(payload) {
  if (!shouldSendTelemetry()) return false
  const body = JSON.stringify(payload)
  if (body.length > MAX_PAYLOAD_BYTES) return false

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(TELEMETRY_ENDPOINT, blob)) {
        return true
      }
    }
  } catch (err) {
    // Ignore transport failures and fall back to fetch.
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS)
    : null

  fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    signal: controller?.signal
  }).catch(() => {})
    .finally(() => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    })

  return true
}

function buildBasePayload({ event, severity, check, interactionType, error, meta }) {
  return {
    event,
    severity,
    path: currentPathname(),
    appVersion: version,
    fingerprint: buildFingerprint({
      event,
      path: currentPathname(),
      message: error?.message,
      check,
      interactionType
    }),
    check,
    interactionType,
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
    error: normalizeError(error),
    meta: normalizeMeta(meta)
  }
}

export function sendLogTelemetry({ event, severity, check, error, meta }) {
  if (!shouldSendTelemetry()) return false
  const payload = buildBasePayload({ event, severity, check, error, meta })
  if (rememberFingerprint(payload.fingerprint)) return false
  return sendPayload(payload)
}

function sendInteractionTelemetry({ event, interactionType, meta }) {
  const payload = buildBasePayload({
    event,
    severity: 'info',
    interactionType,
    meta
  })
  return sendPayload(payload)
}

export function reportVisitorOpened(meta = {}) {
  if (!shouldSendTelemetry() || sessionFlag(OPEN_REPORTED_STORAGE_KEY)) return false
  markSessionFlag(OPEN_REPORTED_STORAGE_KEY)
  return sendInteractionTelemetry({
    event: 'visitor.opened',
    interactionType: 'opened',
    meta
  })
}

export function reportEventSelected(meta = {}) {
  if (!shouldSendTelemetry() || sessionFlag(EVENT_SELECTED_REPORTED_STORAGE_KEY)) return false
  markSessionFlag(EVENT_SELECTED_REPORTED_STORAGE_KEY)
  return sendInteractionTelemetry({
    event: 'visitor.event_selected',
    interactionType: 'event_selected',
    meta
  })
}

export function startVisitorHeartbeat(metaFactory = () => ({})) {
  if (!shouldSendTelemetry()) return () => {}
  if (typeof heartbeatCleanup === 'function') heartbeatCleanup()

  const emitHeartbeat = () => {
    sendInteractionTelemetry({
      event: 'visitor.heartbeat',
      interactionType: 'heartbeat',
      meta: metaFactory()
    })
  }

  emitHeartbeat()
  const intervalId = window.setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS)
  const handleFocus = () => emitHeartbeat()
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') emitHeartbeat()
  }

  window.addEventListener('focus', handleFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  heartbeatCleanup = () => {
    window.clearInterval(intervalId)
    window.removeEventListener('focus', handleFocus)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    heartbeatCleanup = null
  }

  return heartbeatCleanup
}

export function installGlobalTelemetryHandlers(log) {
  if (!shouldSendTelemetry() || globalHandlersInstalled || !log) return
  globalHandlersInstalled = true

  window.addEventListener('error', event => {
    log.error('client.window_error', {
      source: clampString(event.filename || 'window', 80),
      line: typeof event.lineno === 'number' ? event.lineno : undefined,
      column: typeof event.colno === 'number' ? event.colno : undefined
    }, event.error || event.message || 'Window error')
  })

  window.addEventListener('unhandledrejection', event => {
    log.error('client.unhandled_rejection', undefined, event.reason || 'Unhandled rejection')
  })
}

export function resetTelemetryStateForTests() {
  globalHandlersInstalled = false
  if (typeof heartbeatCleanup === 'function') heartbeatCleanup()
}
