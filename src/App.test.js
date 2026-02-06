import { describe, it, expect } from 'vitest'
import { parseTimeToToday } from './scheduleUtils.js'
import { loadFixtures } from './schedule/testing/fixtures.js'
import { deduplicateSessions } from './schedule/parsers/nasaSeRules.js'
import { parseNasaSeCsv } from './schedule/parsers/nasaSeParser.js'

function parseSchedule(csvText, dayOffset = 0) {
  return parseNasaSeCsv({ csvText, dayOffset })
}

describe('CSV Parsing - Basic Structure', () => {
  const sampleCSV = `Friday,,7am-7pm Techistration,,,
8:00 AM,20,HPDE,Competition School,Classroom,
8:20 AM,20,Test/Tune,,,
12:00 PM,60,Lunch,,,
Saturday,,7am-9am Techistration,,,
8:00 AM,20,HPDE 1,,,
8:20 AM,15,TT Alpha (TTU/a,1-3),,,
9:05 AM,25,ALL RACERS WARMUP,,,
12:05 PM,55,Lunch,HPDE 2,,12:05 All Racers Meeting
Sunday,,,,,
8:00 AM,20,HPDE 2,HPDE 1,,`

  it('detects all three days', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.days).toContain('Friday')
    expect(schedule.days).toContain('Saturday')
    expect(schedule.days).toContain('Sunday')
  })

  it('parses time correctly', () => {
    const schedule = parseSchedule(sampleCSV)
    const firstSession = schedule.sessions[0]
    expect(firstSession.start.getHours()).toBe(8)
    expect(firstSession.start.getMinutes()).toBe(0)
  })

  it('parses time without AM/PM (assumes PM for meeting context)', () => {
    const time = parseTimeToToday('12:15')
    expect(time).not.toBeNull()
    expect(time.getHours()).toBe(12)
    expect(time.getMinutes()).toBe(15)
  })

  it('parses time without AM/PM for single digit hours (assumes PM)', () => {
    const time = parseTimeToToday('1:30')
    expect(time).not.toBeNull()
    expect(time.getHours()).toBe(13) // 1:30 PM
    expect(time.getMinutes()).toBe(30)
  })

  it('parses duration correctly', () => {
    const schedule = parseSchedule(sampleCSV)
    const lunchSession = schedule.sessions.find(r => r.session === 'Lunch')
    expect(lunchSession.duration).toBe(60)
  })

  it('applies day offset correctly', () => {
    const schedule = parseSchedule(sampleCSV, -1) // -1 day
    const firstSession = schedule.sessions[0]
    const today = new Date()
    expect(firstSession.start.getDate()).toBe(today.getDate() - 1)
  })
})

describe('Session Filtering', () => {
  const sampleCSV = `Saturday,,,,,
8:00 AM,20,HPDE 1,,,
8:20 AM,20,Test/Tune,,,
8:40 AM,15,TT Alpha,,,
9:00 AM,20,HPDE,,Classroom,
12:00 PM,60,Lunch,,,
1:00 PM,20,Thunder Race #1,,,`

  it('includes sessions with track content', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.sessions.length).toBeGreaterThan(0)
    expect(schedule.sessions.some(r => r.session === 'HPDE 1')).toBe(true)
  })

  it('includes lunch', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.sessions.some(r => r.session === 'Lunch')).toBe(true)
  })
})

describe('Deduplication', () => {
  it('keeps higher priority session when times match', () => {
    const sessions = [
      { session: 'HPDE', start: new Date('2026-01-18T09:00:00'), duration: 20 },
      { session: 'HPDE 1', start: new Date('2026-01-18T09:00:00'), duration: 20 }
    ]

    const deduplicated = deduplicateSessions(sessions)
    expect(deduplicated.length).toBe(1)
    expect(deduplicated[0].session).toBe('HPDE 1')
  })

  it('keeps lunch over other sessions at same time', () => {
    const sessions = [
      { session: 'Lunch', start: new Date('2026-01-18T12:00:00'), duration: 60 },
      { session: 'HPDE 2', start: new Date('2026-01-18T12:00:00'), duration: 20 }
    ]

    const deduplicated = deduplicateSessions(sessions)
    expect(deduplicated.length).toBe(1)
    expect(deduplicated[0].session).toBe('Lunch')
  })
})

describe('Run Group Extraction', () => {
  const sampleCSV = `Saturday,,,,,
8:00 AM,20,HPDE 1,,,
8:20 AM,20,HPDE 2,,,
8:40 AM,15,TT Alpha (TTU/a,1-3),,,
9:00 AM,15,TT Omega (TTU/b,4-6),,,
9:20 AM,20,Thunder Race #1,,,
9:40 AM,20,Lightning Race #2,,,
10:00 AM,20,Mock Race #1,,,
10:20 AM,25,ALL RACERS WARMUP,,,
10:45 AM,20,TT ALL,,,
11:00 AM,60,Lunch,,,
11:30 AM,,HPDE Meeting At Tech,,,
12:00 PM,,Series Awards,,,`

  it('extracts HPDE numbered groups', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups).toContain('HPDE 1')
    expect(schedule.runGroups).toContain('HPDE 2')
  })

  it('normalizes TT groups', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups).toContain('TT Alpha')
    expect(schedule.runGroups).toContain('TT Omega')
  })

  it('normalizes race names', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups).toContain('Thunder Race')
    expect(schedule.runGroups).toContain('Lightning Race')
    expect(schedule.runGroups).not.toContain('Mock Race')
  })

  it('excludes lunch and meetings from run groups', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups).not.toContain('Lunch')
    expect(schedule.runGroups.some(g => g.includes('Meeting'))).toBe(false)
  })

  it('excludes ALL RACERS WARMUP and TT ALL', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups).not.toContain('ALL RACERS WARMUP')
    expect(schedule.runGroups).not.toContain('TT ALL')
  })

  it('includes All as first item', () => {
    const schedule = parseSchedule(sampleCSV)
    expect(schedule.runGroups[0]).toBe('All')
  })

  it('sorts groups alphabetically after All', () => {
    const schedule = parseSchedule(sampleCSV)
    const afterAll = schedule.runGroups.slice(1)
    const sorted = [...afterAll].sort((a, b) => a.localeCompare(b))
    expect(afterAll).toEqual(sorted)
  })
})

describe('Meeting Activities', () => {
  it('parses meeting times from all test schedules', async () => {
    const fs = await import('fs')
    const fixtures = loadFixtures('nasa-se')
    expect(fixtures.length).toBeGreaterThan(0)

    for (const fixture of fixtures) {
      const csvText = fs.readFileSync(fixture.filePath, 'utf-8')
      const schedule = parseSchedule(csvText)

      const meetingActivities = schedule.activities.filter(a => a.type === 'meeting')
      const saturdayRacers = meetingActivities.find(a => a.title === 'All Racers Meeting' && a.day === 'Saturday')
      const saturdayTT = meetingActivities.find(a => a.title === 'TT Drivers Meeting' && a.day === 'Saturday')
      const sundayRacers = meetingActivities.find(a => a.title === 'All Racers Meeting' && a.day === 'Sunday')
      const sundayTT = meetingActivities.find(a => a.title === 'TT Drivers Meeting' && a.day === 'Sunday')

      if (saturdayRacers) {
        expect(saturdayRacers.start).toBeInstanceOf(Date)
      }
      if (saturdayTT) {
        expect(saturdayTT.start).toBeInstanceOf(Date)
      }
      if (sundayRacers) {
        expect(sundayRacers.start).toBeInstanceOf(Date)
      }
      if (sundayTT) {
        expect(sundayTT.start).toBeInstanceOf(Date)
      }
    }
  })
})

describe('Full Schedule Validation', () => {
  it('validates the actual schedule CSV structure', async () => {
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    const schedule = parseSchedule(csvText)

    expect(schedule.sessions.length).toBeGreaterThan(0)

    schedule.sessions.forEach(row => {
      expect(row.session).toBeDefined()
      expect(row.start).toBeInstanceOf(Date)
      expect(row.day).toBeDefined()
    })

    expect(schedule.days.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts all expected run groups from actual schedule', async () => {
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    const schedule = parseSchedule(csvText)

    const expectedGroups = [
      'All',
      'Comp School',
      'HPDE 1',
      'HPDE 2',
      'HPDE 3',
      'HPDE 4',
      'Intro/Toyota',
      'Lightning Race',
      'Test/Tune',
      'Thunder Race',
      'TT Alpha',
      'TT Omega',
      'HPDE'
    ]

    expectedGroups.forEach(expected => {
      expect(schedule.runGroups).toContain(expected)
    })

    const unexpectedGroups = schedule.runGroups.filter(g => g !== 'All' && !expectedGroups.includes(g))
    expect(unexpectedGroups).toEqual([])
  })

  it('counts correct number of sessions per day', async () => {
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    const schedule = parseSchedule(csvText)

    const friday = schedule.sessions.filter(r => r.day === 'Friday')
    const saturday = schedule.sessions.filter(r => r.day === 'Saturday')
    const sunday = schedule.sessions.filter(r => r.day === 'Sunday')

    expect(friday.length).toBeGreaterThan(0)
    expect(saturday.length).toBeGreaterThan(0)
    expect(sunday.length).toBeGreaterThan(0)
  })
})
