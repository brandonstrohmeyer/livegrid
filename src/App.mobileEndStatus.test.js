import { describe, it, expect } from 'vitest'
import { getMobileSessionEndStatus } from './App.jsx'

describe('getMobileSessionEndStatus', () => {
  it('returns null when the session has ended', () => {
    const now = new Date('2026-02-14T12:00:00Z')
    const session = {
      start: new Date('2026-02-14T11:00:00Z'),
      end: new Date('2026-02-14T11:59:59Z')
    }
    expect(getMobileSessionEndStatus(session, now)).toBeNull()
  })

  it('returns "Ending now" when under one minute remains', () => {
    const now = new Date('2026-02-14T12:00:00Z')
    const session = {
      start: new Date('2026-02-14T11:00:00Z'),
      end: new Date('2026-02-14T12:00:30Z')
    }
    expect(getMobileSessionEndStatus(session, now)).toEqual({
      text: 'Ending now',
      showPrefix: false
    })
  })

  it('formats remaining time in minutes or hours + minutes', () => {
    const now = new Date('2026-02-14T12:00:00Z')
    const shortSession = {
      start: new Date('2026-02-14T11:00:00Z'),
      end: new Date('2026-02-14T12:04:10Z')
    }
    const longSession = {
      start: new Date('2026-02-14T11:00:00Z'),
      end: new Date('2026-02-14T13:05:00Z')
    }

    expect(getMobileSessionEndStatus(shortSession, now)).toEqual({
      text: '5m',
      showPrefix: true
    })
    expect(getMobileSessionEndStatus(longSession, now)).toEqual({
      text: '1h 5m',
      showPrefix: true
    })
  })
})
