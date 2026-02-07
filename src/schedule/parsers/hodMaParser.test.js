import { describe, it, expect } from 'vitest'
import { parseHodMaCsv } from './hodMaParser.js'

const baseCsv = `Activity,Time,WHO,Where
Gate Opens,7:00 AM,ALL,`

describe('HOD-MA Parser', () => {
  it('infers day from source label', () => {
    const schedule = parseHodMaCsv({ csvText: baseCsv, sourceLabel: 'Sample Sat.csv' })
    expect(schedule.days).toContain('Saturday')
  })

  it('expands C/D and maps A1 to A', () => {
    const csv = `Activity,Time,WHO,Where
ON TRACK - AM,8:00 AM,C/D,
,8:20 AM,A1,`
    const schedule = parseHodMaCsv({ csvText: csv, sourceLabel: 'Test Sat.csv' })

    const cdSession = schedule.sessions.find(s => (
      Array.isArray(s.runGroupIds) &&
      s.runGroupIds.includes('C - Advanced') &&
      s.runGroupIds.includes('D - Expert')
    ))
    expect(cdSession.runGroupIds).toEqual(['C - Advanced', 'D - Expert'])

    const aSession = schedule.sessions.find(s => s.session === 'A - Novice')
    expect(aSession.runGroupIds).toEqual(['A - Novice'])
  })

  it('treats Happy Hour as an on-track session', () => {
    const csv = `Activity,Time,WHO,Where
Happy Hour,4:00 PM,B+C+D,`
    const schedule = parseHodMaCsv({ csvText: csv, sourceLabel: 'Test Sat.csv' })
    const happyHour = schedule.sessions.find(s => s.session === 'Happy Hour')
    expect(happyHour).toBeDefined()
    expect(happyHour.runGroupIds).toEqual(['B - Intermediate', 'C - Advanced', 'D - Expert'])
  })

  it('infers run groups from notes when WHO lacks groups', () => {
    const csv = `Activity,Time,WHO,Where
Party Mode,3:30 PM,Party Mode,"B+C+D Use C Pass Rules"`
    const schedule = parseHodMaCsv({ csvText: csv, sourceLabel: 'Test Sat.csv' })
    const partyMode = schedule.sessions.find(s => s.session === 'Party Mode')
    expect(partyMode).toBeDefined()
    expect(partyMode.runGroupIds).toEqual(['B - Intermediate', 'C - Advanced', 'D - Expert'])
  })

  it('uses Party Mode label when it appears in WHO', () => {
    const csv = `Activity,Time,WHO,Where
,3:30 PM,"PARTY MODE B+C+D (C pass rules)","B+C+D Use C Pass Rules"`
    const schedule = parseHodMaCsv({ csvText: csv, sourceLabel: 'Test Sat.csv' })
    const partyMode = schedule.sessions.find(s => s.session === 'Party Mode')
    expect(partyMode).toBeDefined()
    expect(partyMode.runGroupIds).toEqual(['B - Intermediate', 'C - Advanced', 'D - Expert'])
  })

  it('creates classroom activity tied to group A', () => {
    const csv = `Activity,Time,WHO,Where
A-Novice Class,9:00 AM,A-Novice Class,Classroom`
    const schedule = parseHodMaCsv({ csvText: csv, sourceLabel: 'Test Sat.csv' })
    const classroom = schedule.activities.find(a => a.type === 'classroom')
    expect(classroom).toBeDefined()
    expect(classroom.relatedRunGroupIds).toEqual(['A - Novice'])
  })
})
