import { describe, expect, it } from 'vitest'
import {
  anchorScheduleToEventDates,
  extractSpreadsheetId,
  normalizeDateKey
} from './eventWindow.js'

describe('eventWindow helpers', () => {
  it('matches spreadsheet ids from Google Sheets URLs', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=123')).toBe('TEST_SHEET_ID')
  })

  it('normalizes ISO timestamps to date keys without local timezone drift', () => {
    expect(normalizeDateKey('2026-04-03T00:00:00.000Z')).toBe('2026-04-03')
  })

  it('anchors Friday through Sunday sessions onto concrete event dates', () => {
    const schedule = {
      runGroups: ['All', 'HPDE 1'],
      days: ['Friday', 'Saturday', 'Sunday'],
      warnings: [],
      sessions: [
        {
          session: 'Registration',
          day: 'Friday',
          start: new Date(2026, 0, 1, 18, 0, 0),
          end: new Date(2026, 0, 1, 20, 0, 0),
          duration: 120,
          runGroupIds: [],
          note: '',
          classroom: ''
        },
        {
          session: 'HPDE 1',
          day: 'Saturday',
          start: new Date(2026, 0, 2, 8, 0, 0),
          end: new Date(2026, 0, 2, 8, 20, 0),
          duration: 20,
          runGroupIds: ['HPDE 1'],
          note: '',
          classroom: ''
        },
        {
          session: 'Feature Session',
          day: 'Sunday',
          start: new Date(2026, 0, 3, 9, 30, 0),
          end: new Date(2026, 0, 3, 9, 50, 0),
          duration: 20,
          runGroupIds: ['HPDE 1'],
          note: '',
          classroom: ''
        }
      ],
      activities: []
    }

    const anchored = anchorScheduleToEventDates(schedule, {
      startDateKey: '2026-04-03',
      endDateKey: '2026-04-05'
    })

    expect(anchored.dayDateMap).toEqual({
      Friday: '2026-04-03',
      Saturday: '2026-04-04',
      Sunday: '2026-04-05'
    })
    expect(anchored.schedule.sessions[0].start.toLocaleDateString('en-US')).toBe('4/3/2026')
    expect(anchored.schedule.sessions[1].start.toLocaleDateString('en-US')).toBe('4/4/2026')
    expect(anchored.schedule.sessions[2].start.toLocaleDateString('en-US')).toBe('4/5/2026')
    expect(anchored.windowStart.toLocaleString('en-US')).toContain('4/3/2026')
    expect(anchored.windowEnd.toLocaleString('en-US')).toContain('4/5/2026')
  })

  it('falls back to the all-day event window when there are no anchorable sessions', () => {
    const anchored = anchorScheduleToEventDates({
      runGroups: ['All'],
      sessions: [],
      activities: [],
      days: [],
      warnings: []
    }, {
      startDateKey: '2026-07-18',
      endDateKey: '2026-07-19'
    })

    expect(anchored.windowSource).toBe('event-dates')
    expect(anchored.windowStart.toLocaleDateString('en-US')).toBe('7/18/2026')
    expect(anchored.windowEnd.toLocaleDateString('en-US')).toBe('7/19/2026')
  })
})
