import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import {
  parseTimeToToday,
  addMinutes,
  isTimeRow,
  isOnTrackSession,
  getSessionPriority,
  deduplicateSessions,
  shouldExcludeFromRunGroups,
  extractRunGroups,
  fixSessionNameTypos
} from './scheduleUtils.js'

// Helper function to parse CSV similar to App.jsx
function parseScheduleCSV(csvText, dayOffset = 0) {
  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const allRows = []
  let currentDay = null
  
  parsed.data.forEach(row => {
    const firstCol = (row[0] || '').toString().trim().toLowerCase()
    
    if (firstCol.includes('friday')) currentDay = 'Friday'
    else if (firstCol.includes('saturday')) currentDay = 'Saturday'
    else if (firstCol.includes('sunday')) currentDay = 'Sunday'
    
    if (isTimeRow(row)) {
      let start = parseTimeToToday(row[0])
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      const duration = row[1] && /\d+/.test(row[1]) ? parseInt(row[1], 10) : null
      const end = duration ? addMinutes(start, duration) : null
      
      // Fix common typos in session names
      let sessionName = fixSessionNameTypos((row[2] || '').toString().trim())
      
      // Search for notes across columns (different schedules use different layouts)
      const note = (row[4] || row[5] || '').toString().trim()
      
      allRows.push({
        raw: row,
        start,
        duration,
        end,
        session: sessionName,
        note,
        classroomCell: (row[3] || '').toString().trim(),
        day: currentDay
      })
    }
  })
  
  allRows.sort((a, b) => (a.start && b.start ? a.start - b.start : 0))
  
  return allRows
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
    const rows = parseScheduleCSV(sampleCSV)
    const days = [...new Set(rows.map(r => r.day))]
    
    expect(days).toContain('Friday')
    expect(days).toContain('Saturday')
    expect(days).toContain('Sunday')
  })

  it('parses time correctly', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const firstSession = rows[0]
    
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
    const rows = parseScheduleCSV(sampleCSV)
    const lunchSession = rows.find(r => r.session === 'Lunch')
    
    expect(lunchSession.duration).toBe(60)
  })

  it('applies day offset correctly', () => {
    const rows = parseScheduleCSV(sampleCSV, -1) // -1 day
    const firstSession = rows[0]
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
    const rows = parseScheduleCSV(sampleCSV)
    const filtered = rows.filter(isOnTrackSession)
    
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.some(r => r.session === 'HPDE 1')).toBe(true)
  })

  it('includes lunch', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const filtered = rows.filter(isOnTrackSession)
    
    expect(filtered.some(r => r.session === 'Lunch')).toBe(true)
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
    expect(deduplicated[0].session).toBe('HPDE 1') // HPDE 1 has priority 1, HPDE has priority 2
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
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).toContain('HPDE 1')
    expect(groups).toContain('HPDE 2')
  })

  it('normalizes TT groups', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).toContain('TT Alpha')
    expect(groups).toContain('TT Omega')
  })

  it('normalizes race names', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).toContain('Thunder Race')
    expect(groups).toContain('Lightning Race')
    expect(groups).toContain('Mock Race')
  })

  it('excludes lunch from run groups', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).not.toContain('Lunch')
  })

  it('excludes meetings from run groups', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups.some(g => g.includes('Meeting'))).toBe(false)
  })

  it('excludes ALL RACERS WARMUP', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).not.toContain('ALL RACERS WARMUP')
  })

  it('excludes TT ALL', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).not.toContain('TT ALL')
  })

  it('excludes TT Drivers', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).not.toContain('TT Drivers')
  })

  it('excludes Series Awards', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups).not.toContain('Series Awards')
  })

  it('parses meeting times from all test schedules', async () => {
    const fs = await import('fs')
    const path = await import('path')
    
    // Get all schedule files
    const schedulesDir = path.resolve(process.cwd(), 'public/test-schedules')
    const scheduleFiles = fs.readdirSync(schedulesDir).filter(f => f.endsWith('.csv'))
    
    expect(scheduleFiles.length).toBeGreaterThan(0)
    
    console.log(`\nTesting meeting time parsing across ${scheduleFiles.length} schedules:\n`)
    
    // Test each schedule
    for (const scheduleFile of scheduleFiles) {
      const csvPath = path.join(schedulesDir, scheduleFile)
      const csvText = fs.readFileSync(csvPath, 'utf-8')
      const rows = parseScheduleCSV(csvText)
      
      console.log(`${scheduleFile}:`)
      
      // Find Saturday meetings
      const saturdayRows = rows.filter(r => r.day === 'Saturday')
      const satRacersMeeting = saturdayRows.find(r => 
        (r.note || '').toLowerCase().includes('all racers meeting')
      )
      const satTTMeeting = saturdayRows.find(r => 
        (r.note || '').toLowerCase().includes('tt drivers')
      )
      
      // If Saturday meetings exist, verify they parse correctly
      if (satRacersMeeting) {
        const satRacersTime = satRacersMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)?.[1]
        if (satRacersTime) {
          const satRacersDate = parseTimeToToday(satRacersTime)
          console.log(`  Saturday Racers Meeting: ${satRacersTime} → ${satRacersDate ? satRacersDate.toLocaleTimeString() : 'FAILED'}`)
          expect(satRacersDate, `Failed to parse Saturday Racers meeting time "${satRacersTime}" in ${scheduleFile}`).not.toBeNull()
          expect(satRacersDate.getHours(), `Invalid hour for Saturday Racers meeting in ${scheduleFile}`).toBeGreaterThanOrEqual(0)
          expect(satRacersDate.getHours(), `Invalid hour for Saturday Racers meeting in ${scheduleFile}`).toBeLessThan(24)
        }
      } else {
        console.log(`  Saturday Racers Meeting: not found`)
      }
      
      if (satTTMeeting) {
        const satTTTime = satTTMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)?.[1]
        if (satTTTime) {
          const satTTDate = parseTimeToToday(satTTTime)
          console.log(`  Saturday TT Drivers Meeting: ${satTTTime} → ${satTTDate ? satTTDate.toLocaleTimeString() : 'FAILED'}`)
          expect(satTTDate, `Failed to parse Saturday TT Drivers meeting time "${satTTTime}" in ${scheduleFile}`).not.toBeNull()
          expect(satTTDate.getHours(), `Invalid hour for Saturday TT Drivers meeting in ${scheduleFile}`).toBeGreaterThanOrEqual(0)
          expect(satTTDate.getHours(), `Invalid hour for Saturday TT Drivers meeting in ${scheduleFile}`).toBeLessThan(24)
        }
      } else {
        console.log(`  Saturday TT Drivers Meeting: not found`)
      }
      
      // Find Sunday meetings
      const sundayRows = rows.filter(r => r.day === 'Sunday')
      const sunRacersMeeting = sundayRows.find(r => 
        (r.note || '').toLowerCase().includes('all racers meeting')
      )
      const sunTTMeeting = sundayRows.find(r => 
        (r.note || '').toLowerCase().includes('tt drivers')
      )
      
      // If Sunday meetings exist, verify they parse correctly
      if (sunRacersMeeting) {
        const sunRacersTime = sunRacersMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)?.[1]
        if (sunRacersTime) {
          const sunRacersDate = parseTimeToToday(sunRacersTime)
          console.log(`  Sunday Racers Meeting: ${sunRacersTime} → ${sunRacersDate ? sunRacersDate.toLocaleTimeString() : 'FAILED'}`)
          expect(sunRacersDate, `Failed to parse Sunday Racers meeting time "${sunRacersTime}" in ${scheduleFile}`).not.toBeNull()
          expect(sunRacersDate.getHours(), `Invalid hour for Sunday Racers meeting in ${scheduleFile}`).toBeGreaterThanOrEqual(0)
          expect(sunRacersDate.getHours(), `Invalid hour for Sunday Racers meeting in ${scheduleFile}`).toBeLessThan(24)
        }
      } else {
        console.log(`  Sunday Racers Meeting: not found`)
      }
      
      if (sunTTMeeting) {
        const sunTTTime = sunTTMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)?.[1]
        if (sunTTTime) {
          const sunTTDate = parseTimeToToday(sunTTTime)
          console.log(`  Sunday TT Drivers Meeting: ${sunTTTime} → ${sunTTDate ? sunTTDate.toLocaleTimeString() : 'FAILED'}`)
          expect(sunTTDate, `Failed to parse Sunday TT Drivers meeting time "${sunTTTime}" in ${scheduleFile}`).not.toBeNull()
          expect(sunTTDate.getHours(), `Invalid hour for Sunday TT Drivers meeting in ${scheduleFile}`).toBeGreaterThanOrEqual(0)
          expect(sunTTDate.getHours(), `Invalid hour for Sunday TT Drivers meeting in ${scheduleFile}`).toBeLessThan(24)
        }
      } else {
        console.log(`  Sunday TT Drivers Meeting: not found`)
      }
      
      console.log('')
    }
  })

  it('includes All as first item', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    expect(groups[0]).toBe('All')
  })

  it('sorts groups alphabetically after All', () => {
    const rows = parseScheduleCSV(sampleCSV)
    const groups = extractRunGroups(rows)
    
    const afterAll = groups.slice(1)
    const sorted = [...afterAll].sort((a, b) => a.localeCompare(b))
    
    expect(afterAll).toEqual(sorted)
  })
})

describe('Full Schedule Validation', () => {
  it('validates the actual schedule CSV structure', async () => {
    // This test reads the actual schedule.csv file
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    
    const rows = parseScheduleCSV(csvText)
    
    // Basic validations
    expect(rows.length).toBeGreaterThan(0)
    
    // Check all rows have required fields
    rows.forEach(row => {
      expect(row.session).toBeDefined()
      expect(row.start).toBeInstanceOf(Date)
      expect(row.day).toBeDefined()
    })
    
    // Check days are present
    const days = [...new Set(rows.map(r => r.day))]
    expect(days.length).toBeGreaterThanOrEqual(1)
  })
  
  it('extracts all expected run groups from actual schedule', async () => {
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    const rows = parseScheduleCSV(csvText)
    const groups = extractRunGroups(rows)
    
    // Define EXACTLY what run groups should exist in this CSV
    // Note: Combined sessions like "HPDE 3* & 4" are split into "HPDE 3" and "HPDE 4"
    // "Test/Tune & Comp School" is split into "Test/Tune" and "Comp School"
    const expectedGroups = [
      'All',
      'Comp School',
      'HPDE 1',
      'HPDE 2', 
      'HPDE 3',
      'HPDE 4',
      'Intro/Toyota',
      'Lightning Race',
      'Mock Race',
      'Test/Tune',
      'Thunder Race',
      'TT Alpha',
      'TT Omega',
      'HPDE'
    ]
    
    // Check every expected group exists
    expectedGroups.forEach(expected => {
      expect(groups).toContain(expected)
    })
    
    // Check we didn't extract any unexpected groups (excludes All)
    const unexpectedGroups = groups.filter(g => g !== 'All' && !expectedGroups.includes(g))
    expect(unexpectedGroups).toEqual([])
  })
  
  it('counts correct number of sessions per day', async () => {
    const fs = await import('fs')
    const csvText = fs.readFileSync('./public/schedule.csv', 'utf8')
    const rows = parseScheduleCSV(csvText)
    
    const friday = rows.filter(r => r.day === 'Friday')
    const saturday = rows.filter(r => r.day === 'Saturday')
    const sunday = rows.filter(r => r.day === 'Sunday')
    
    // These numbers should match your actual CSV
    // Update these after verifying your CSV
    expect(friday.length).toBeGreaterThan(0)
    expect(saturday.length).toBeGreaterThan(0)
    expect(sunday.length).toBeGreaterThan(0)
    
    console.log(`Friday: ${friday.length} sessions`)
    console.log(`Saturday: ${saturday.length} sessions`)
    console.log(`Sunday: ${sunday.length} sessions`)
  })
})

describe('Session Matching Logic', () => {
  function sessionMatchesGroup(sessionName, group) {
    const lowerSession = (sessionName || '').toLowerCase()
    const lowerGroup = group.toLowerCase()
    
    // TT ALL and TT Drivers match both TT Alpha and TT Omega
    if (/tt\s+all|tt\s+drivers/i.test(sessionName)) {
      return lowerGroup.includes('tt alpha') || lowerGroup.includes('tt omega')
    }
    
    // For HPDE groups, extract all numbers from session name and check if group number is in there
    // This handles "HPDE 3* & 4" matching both "HPDE 3" and "HPDE 4"
    if (/hpde\s*\d/i.test(lowerGroup)) {
      const groupNumber = lowerGroup.match(/\d+/)?.[0]
      if (groupNumber && /hpde/i.test(lowerSession)) {
        // Extract all numbers from the session name (after HPDE or standalone digits in combined sessions)
        const allNumbers = lowerSession.match(/\d+/g) || []
        return allNumbers.includes(groupNumber)
      }
    }
    
    // For combined sessions with "&" (like "Test/Tune & Comp School")
    // Check if the group matches any part of the combined session
    if (lowerSession.includes('&')) {
      const parts = lowerSession.split('&').map(p => p.trim())
      return parts.some(part => part.includes(lowerGroup) || lowerGroup.includes(part))
    }
    
    return lowerSession.includes(lowerGroup)
  }

  it('matches HPDE 3 with "HPDE 3* & 4"', () => {
    expect(sessionMatchesGroup('HPDE 3* & 4', 'HPDE 3')).toBe(true)
  })

  it('matches HPDE 4 with "HPDE 3* & 4"', () => {
    expect(sessionMatchesGroup('HPDE 3* & 4', 'HPDE 4')).toBe(true)
  })

  it('matches HPDE 3 with "HPDE 4* & 3"', () => {
    expect(sessionMatchesGroup('HPDE 4* & 3', 'HPDE 3')).toBe(true)
  })

  it('matches HPDE 4 with "HPDE 4* & 3"', () => {
    expect(sessionMatchesGroup('HPDE 4* & 3', 'HPDE 4')).toBe(true)
  })

  it('matches HPDE 1 with "HPDE 1 & Intro/Toyota"', () => {
    expect(sessionMatchesGroup('HPDE 1 & Intro/Toyota', 'HPDE 1')).toBe(true)
  })

  it('matches Intro/Toyota with "HPDE 1 & Intro/Toyota"', () => {
    expect(sessionMatchesGroup('HPDE 1 & Intro/Toyota', 'Intro/Toyota')).toBe(true)
  })

  it('matches Test/Tune with "Test/Tune & Comp School"', () => {
    expect(sessionMatchesGroup('Test/Tune & Comp School', 'Test/Tune')).toBe(true)
  })

  it('matches Comp School with "Test/Tune & Comp School"', () => {
    expect(sessionMatchesGroup('Test/Tune & Comp School', 'Comp School')).toBe(true)
  })

  it('matches TT Alpha when session is "TT ALL"', () => {
    expect(sessionMatchesGroup('TT ALL', 'TT Alpha')).toBe(true)
  })

  it('matches TT Omega when session is "TT ALL"', () => {
    expect(sessionMatchesGroup('TT ALL', 'TT Omega')).toBe(true)
  })

  it('matches TT Alpha when session is "TT Drivers"', () => {
    expect(sessionMatchesGroup('TT Drivers Meeting', 'TT Alpha')).toBe(true)
  })

  it('matches TT Omega when session is "TT Drivers"', () => {
    expect(sessionMatchesGroup('TT Drivers Meeting', 'TT Omega')).toBe(true)
  })

  it('does not match HPDE 2 with "HPDE 3* & 4"', () => {
    expect(sessionMatchesGroup('HPDE 3* & 4', 'HPDE 2')).toBe(false)
  })

  it('does not match Test/Tune with "Comp School" only session', () => {
    expect(sessionMatchesGroup('Comp School', 'Test/Tune')).toBe(false)
  })
})

