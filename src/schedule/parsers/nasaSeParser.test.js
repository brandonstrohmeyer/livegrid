import { describe, it, expect } from 'vitest'
import { parseNasaSeCsv } from './nasaSeParser.js'

describe('NASA-SE Parser', () => {
  it('detects day headers', () => {
    const csv = `Friday,,,,
8:00 AM,20,HPDE 1,,,
Saturday,,,,
9:00 AM,20,HPDE 2,,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    expect(schedule.days).toContain('Friday')
    expect(schedule.days).toContain('Saturday')
  })

  it('maps HPDE 3* & 4 to runGroupIds', () => {
    const csv = `Saturday,,,,
8:00 AM,20,HPDE 3* & 4,,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    const session = schedule.sessions.find(s => s.session === 'HPDE 3* & 4')
    expect(session.runGroupIds).toContain('HPDE 3')
    expect(session.runGroupIds).toContain('HPDE 4')
  })

  it('maps TT ALL to TT Alpha and TT Omega', () => {
    const csv = `Saturday,,,,
9:00 AM,20,TT ALL,,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    const session = schedule.sessions.find(s => s.session === 'TT ALL')
    expect(session.runGroupIds).toContain('TT Alpha')
    expect(session.runGroupIds).toContain('TT Omega')
  })

  it('extracts All Racers Meeting with race groups', () => {
    const csv = `Saturday,,,,
9:00 AM,20,Thunder Race #1,,,
12:00 PM,60,Lunch,,,12:00 All Racers Meeting`
    const schedule = parseNasaSeCsv({ csvText: csv })
    const meeting = schedule.activities.find(a => a.title === 'All Racers Meeting')
    expect(meeting).toBeDefined()
    expect(meeting.relatedRunGroupIds).toContain('Thunder Race')
  })

  it('extracts classroom activity linked to HPDE 1', () => {
    const csv = `Saturday,,,,
8:00 AM,20,HPDE 2,HPDE 1,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    const classroom = schedule.activities.find(a => a.type === 'classroom')
    expect(classroom).toBeDefined()
    expect(classroom.relatedRunGroupIds).toContain('HPDE 1')
  })

  it('maps Mock Race to Test/Tune and All Racers Warmup to Thunder/Lightning', () => {
    const csv = `Saturday,,,,
8:00 AM,20,Mock Race #1,,,
8:20 AM,20,ALL RACERS WARMUP,,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    const mockRace = schedule.sessions.find(s => /mock race/i.test(s.session))
    const warmup = schedule.sessions.find(s => /all racers warmup/i.test(s.session))

    expect(mockRace.runGroupIds).toContain('Test/Tune')
    expect(mockRace.runGroupIds).not.toContain('Thunder Race')
    expect(mockRace.runGroupIds).not.toContain('Lightning Race')
    expect(warmup.runGroupIds).toContain('Thunder Race')
    expect(warmup.runGroupIds).toContain('Lightning Race')
  })

  it('deduplicates sessions at the same time', () => {
    const csv = `Saturday,,,,
9:00 AM,20,HPDE,,,
9:00 AM,20,HPDE 1,,,`
    const schedule = parseNasaSeCsv({ csvText: csv })
    expect(schedule.sessions.length).toBe(1)
    expect(schedule.sessions[0].session).toBe('HPDE 1')
  })
})
