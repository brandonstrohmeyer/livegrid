import {
  isResolvedEventDateRelevant,
  parseDateKeyToUtcDate
} from './eventDates'

type TimestampLike = {
  toDate?: () => Date
  toMillis?: () => number
}

function timestampLikeToDate(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const candidate = value as TimestampLike
  if (typeof candidate.toDate === 'function') {
    const date = candidate.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  if (typeof candidate.toMillis === 'function') {
    const millis = candidate.toMillis()
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function getCachedEventEndDate(data: any) {
  return timestampLikeToDate(data?.endDate)
    || timestampLikeToDate(data?.startDate)
    || parseDateKeyToUtcDate(data?.endDateKey || data?.startDateKey)
}

export function shouldDeactivateStaleEventCacheEntry(data: any, now: Date, graceMs: number) {
  return !isResolvedEventDateRelevant(getCachedEventEndDate(data), now, graceMs)
}
