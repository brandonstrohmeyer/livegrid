import { sendLogTelemetry } from './telemetry.js'

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
}

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const nodeEnv = typeof process !== 'undefined' && process.env ? process.env : {}
const defaultLevel = env.MODE === 'production' ? 'info' : 'debug'
const configuredLevel = env.VITE_LOG_LEVEL || nodeEnv.VITE_LOG_LEVEL || defaultLevel
const activeLevel = LEVELS[configuredLevel] ?? LEVELS.info

function shouldForwardTelemetry(level, event) {
  if (level === 'warn' || level === 'error') return true
  return event === 'firebase.client_disabled'
}

function normalizeError(err) {
  if (!err) return undefined
  if (typeof err === 'string') return { message: err }
  if (err instanceof Error) {
    const payload = {
      message: err.message,
      name: err.name,
      stack: err.stack
    }
    if (typeof err.code === 'string' || typeof err.code === 'number') {
      payload.code = err.code
    }
    return payload
  }
  if (typeof err === 'object') {
    const payload = { message: 'Unknown error' }
    if (typeof err.message === 'string') payload.message = err.message
    if (typeof err.name === 'string') payload.name = err.name
    if (typeof err.stack === 'string') payload.stack = err.stack
    if (typeof err.code === 'string' || typeof err.code === 'number') payload.code = err.code
    return payload
  }
  return { message: String(err) }
}

function buildPayload(event, data, err) {
  const payload = { event }
  if (data && typeof data === 'object') {
    Object.assign(payload, data)
  }
  const error = normalizeError(err)
  if (error) payload.error = error
  return payload
}

function shouldLog(level) {
  return LEVELS[level] >= activeLevel
}

function emit(level, payload) {
  if (!shouldLog(level)) return
  const logger = level === 'debug'
    ? console.debug
    : level === 'info'
        ? console.info
        : level === 'warn'
            ? console.warn
            : console.error
  logger(payload)

  if (shouldForwardTelemetry(level, payload.event)) {
    sendLogTelemetry({
      event: payload.event,
      severity: level,
      check: typeof payload.check === 'string' ? payload.check : undefined,
      error: payload.error,
      meta: payload
    })
  }
}

export const log = {
  debug(event, data, err) {
    emit('debug', buildPayload(event, data, err))
  },
  info(event, data, err) {
    emit('info', buildPayload(event, data, err))
  },
  warn(event, data, err) {
    emit('warn', buildPayload(event, data, err))
  },
  error(event, data, err) {
    emit('error', buildPayload(event, data, err))
  }
}
