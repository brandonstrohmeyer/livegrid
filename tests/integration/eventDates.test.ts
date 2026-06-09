import { describe, expect, it } from 'vitest'
import {
  extractHodEventListingsFromOrg,
  parseDateRangeFromText,
  resolveEventDateRangeFromCandidates,
  toDateKey
} from '../../functions/src/eventDates'

describe('event date helpers', () => {
  it('parses repeated-month HOD org listing ranges', () => {
    const range = parseDateRangeFromText('Sat, Jul 4 - Sun, Jul 5', new Date('2026-01-01T00:00:00Z'))
    expect(range).not.toBeNull()
    expect(toDateKey(range?.start || null)).toBe('2026-07-04')
    expect(toDateKey(range?.end || null)).toBe('2026-07-05')
  })

  it('parses numeric month/day ranges', () => {
    const range = parseDateRangeFromText('Hooked On Driving @ NCM Motorsports Park 6/28-29', new Date('2026-01-01T00:00:00Z'))
    expect(range).not.toBeNull()
    expect(toDateKey(range?.start || null)).toBe('2026-06-28')
    expect(toDateKey(range?.end || null)).toBe('2026-06-29')
  })

  it('resolves NASA dates from an event page when feed text has no date', () => {
    const resolution = resolveEventDateRangeFromCandidates([
      { text: 'NASA-SE Event Without Date', source: 'title' },
      { text: '<p><a href="https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit">Live schedule</a></p>', source: 'feed-content' },
      { text: '<html><title>NASA Weekend Apr 10-12 2026</title></html>', source: 'event-page' }
    ], {
      fallbackDate: new Date('2026-02-02T12:00:00Z')
    })

    expect(resolution.dateResolved).toBe(true)
    expect(resolution.dateSource).toBe('event-page')
    expect(toDateKey(resolution.start)).toBe('2026-04-10')
    expect(toDateKey(resolution.end)).toBe('2026-04-12')
  })

  it('does not silently fall back to pubDate when no real event date is found', () => {
    const resolution = resolveEventDateRangeFromCandidates([
      { text: 'NASA-SE Event Without Date', source: 'title' },
      { text: '<p>No event dates here.</p>', source: 'feed-content' }
    ], {
      fallbackDate: new Date('2026-02-02T12:00:00Z')
    })

    expect(resolution.dateResolved).toBe(false)
    expect(resolution.dateSource).toBeNull()
    expect(resolution.start).toBeNull()
    expect(resolution.end).toBeNull()
  })

  it('extracts HOD org listing links with nearby date text', () => {
    const listings = extractHodEventListingsFromOrg(`
      <section>
        <div>Sat, Sep 12 - Sun, Sep 13</div>
        <a href="/events/bills-race-22222/">Bill's Race</a>
      </section>
    `)

    expect(listings).toHaveLength(1)
    expect(listings[0].eventUrl).toBe('https://www.motorsportreg.com/events/bills-race-22222/')
    expect(listings[0].dateText).toContain('Sat, Sep 12 - Sun, Sep 13')
  })
})
