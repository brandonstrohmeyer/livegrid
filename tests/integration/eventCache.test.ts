import { describe, expect, it } from 'vitest'
import {
  getCachedEventEndDate,
  shouldDeactivateStaleEventCacheEntry
} from '../../functions/src/eventCache'

const twoWeekGraceMs = 14 * 24 * 60 * 60 * 1000

describe('event cache retention helpers', () => {
  it('keeps resolved future events active even when they have not been seen recently', () => {
    const shouldDeactivate = shouldDeactivateStaleEventCacheEntry(
      { endDateKey: '2026-09-05' },
      new Date('2026-06-10T12:00:00Z'),
      twoWeekGraceMs
    )

    expect(shouldDeactivate).toBe(false)
  })

  it('keeps recently ended resolved events active during the cache grace period', () => {
    const shouldDeactivate = shouldDeactivateStaleEventCacheEntry(
      { endDateKey: '2026-06-05' },
      new Date('2026-06-10T12:00:00Z'),
      twoWeekGraceMs
    )

    expect(shouldDeactivate).toBe(false)
  })

  it('deactivates resolved events after the grace period has elapsed', () => {
    const shouldDeactivate = shouldDeactivateStaleEventCacheEntry(
      { endDateKey: '2026-05-01' },
      new Date('2026-06-10T12:00:00Z'),
      twoWeekGraceMs
    )

    expect(shouldDeactivate).toBe(true)
  })

  it('reads Firestore-like timestamp values before date keys', () => {
    const endDate = getCachedEventEndDate({
      endDate: {
        toDate: () => new Date('2026-09-05T00:00:00Z')
      },
      endDateKey: '2026-01-01'
    })

    expect(endDate?.toISOString()).toBe('2026-09-05T00:00:00.000Z')
  })
})
