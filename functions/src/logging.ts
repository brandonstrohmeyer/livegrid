import * as logger from 'firebase-functions/logger'

export type LogData = Record<string, unknown>

type ErrorPayload = {
  message: string
  name?: string
  stack?: string
  code?: string | number
}

function normalizeError(err: unknown): ErrorPayload | undefined {
  if (!err) return undefined
  if (typeof err === 'string') return { message: err }
  if (err instanceof Error) {
    const payload: ErrorPayload = {
      message: err.message,
      name: err.name,
      stack: err.stack
    }
    const code = (err as any).code
    if (typeof code === 'string' || typeof code === 'number') {
      payload.code = code
    }
    return payload
  }
  if (typeof err === 'object') {
    const payload: ErrorPayload = { message: 'Unknown error' }
    const maybeMessage = (err as any).message
    const maybeName = (err as any).name
    const maybeStack = (err as any).stack
    const maybeCode = (err as any).code
    if (typeof maybeMessage === 'string') payload.message = maybeMessage
    if (typeof maybeName === 'string') payload.name = maybeName
    if (typeof maybeStack === 'string') payload.stack = maybeStack
    if (typeof maybeCode === 'string' || typeof maybeCode === 'number') payload.code = maybeCode
    return payload
  }
  return { message: String(err) }
}

function buildPayload(event: string, data?: LogData, err?: unknown): LogData {
  const payload: LogData = { event }
  if (data && typeof data === 'object') {
    Object.assign(payload, data)
  }
  const error = normalizeError(err)
  if (error) payload.error = error
  return payload
}

export const log = {
  debug(event: string, data?: LogData, err?: unknown) {
    logger.debug(buildPayload(event, data, err))
  },
  info(event: string, data?: LogData, err?: unknown) {
    logger.info(buildPayload(event, data, err))
  },
  warn(event: string, data?: LogData, err?: unknown) {
    logger.warn(buildPayload(event, data, err))
  },
  error(event: string, data?: LogData, err?: unknown) {
    logger.error(buildPayload(event, data, err))
  }
}

