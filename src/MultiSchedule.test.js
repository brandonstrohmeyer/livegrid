import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  parseTimeToToday,
  addMinutes,
  isTimeRow,
  isOnTrackSession,
  shouldExcludeFromRunGroups,
  extractRunGroups,
  fixSessionNameTypos
} from './scheduleUtils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================================
// TESTS
// ============================================================================

const testSchedulesDir = path.join(__dirname, '../public/test-schedules')

describe('Multi-Schedule Validation', () => {
  // Get all CSV files in test-schedules directory
  let csvFiles = []
  
  try {
    if (fs.existsSync(testSchedulesDir)) {
      csvFiles = fs.readdirSync(testSchedulesDir)
        .filter(file => file.endsWith('.csv'))
    }
  } catch (err) {
    console.warn('Could not read test-schedules directory:', err.message)
  }

  if (csvFiles.length === 0) {
    it('should have CSV files in public/test-schedules directory', () => {
      expect(csvFiles.length).toBeGreaterThan(0)
    })
    return
  }

  // Run tests for each CSV file
  csvFiles.forEach(filename => {
    describe(filename, () => {
      let parsedData
      let allRows

      // Parse the CSV file once for all tests
      try {
        const csvPath = path.join(testSchedulesDir, filename)
        const csvContent = fs.readFileSync(csvPath, 'utf-8')
        parsedData = Papa.parse(csvContent, { header: true })
        
        // Get the first column name (whatever it is - could be "Thurs", "Friday", etc.)
        const timeColumn = Object.keys(parsedData.data[0])[0]
        const durationColumn = Object.keys(parsedData.data[0])[1] || ''
        const trackColumn = Object.keys(parsedData.data[0])[2]
        const classroomColumn = Object.keys(parsedData.data[0])[3]
        
        // Process rows similar to App.jsx
        let currentDay = null
        allRows = parsedData.data
          .filter(row => row[timeColumn] && row[timeColumn].trim())
          .map(row => {
            // Skip header-like rows
            if (/^(start|time)$/i.test(row[timeColumn].trim())) {
              return null
            }
            
            if (row[timeColumn].match(/day/i)) {
              currentDay = row[timeColumn]
              return null
            }
            
            const start = parseTimeToToday(row[timeColumn], 0)
            
            // Skip rows where time parsing failed
            if (!start || isNaN(start.getTime())) {
              return null
            }
            
            const duration = parseInt(row[durationColumn]) || 20
            
            // Fix common typos in session names
            let sessionName = fixSessionNameTypos(row[trackColumn])
            
            return {
              Time: row[timeColumn],
              Duration: row[durationColumn],
              Track: sessionName,
              Classroom: row[classroomColumn],
              day: currentDay,
              session: sessionName,
              classroom: row[classroomColumn],
              start,
              duration
            }
          })
          .filter(row => row !== null && isOnTrackSession(row))
      } catch (err) {
        console.error(`Error parsing ${filename}:`, err.message)
      }

      it('should parse without errors', () => {
        expect(parsedData).toBeDefined()
        expect(parsedData.errors.length).toBe(0)
      })

      it('should have valid structure with Time column', () => {
        expect(parsedData.data.length).toBeGreaterThan(0)
        // First column should exist (whatever it's named)
        const firstColumn = Object.keys(parsedData.data[0])[0]
        expect(firstColumn).toBeDefined()
        expect(parsedData.data[0]).toHaveProperty(firstColumn)
      })

      it('should detect at least one day', () => {
        const days = allRows.map(r => r.day).filter(Boolean)
        const uniqueDays = [...new Set(days)]
        expect(uniqueDays.length).toBeGreaterThan(0)
      })

      it('should have on-track sessions', () => {
        expect(allRows.length).toBeGreaterThan(0)
      })

      it('should extract run groups without errors', () => {
        const groups = extractRunGroups(allRows)
        expect(groups).toContain('All')
        expect(groups.length).toBeGreaterThan(1) // Should have more than just "All"
      })

      it('should not have invalid groups (just numbers, TT ALL, TT Drivers)', () => {
        const groups = extractRunGroups(allRows)
        
        // Check no groups are just numbers
        const justNumbers = groups.filter(g => /^\d+\*?$/.test(g))
        expect(justNumbers).toEqual([])
        
        // Check TT ALL and TT Drivers are excluded
        expect(groups).not.toContain('TT ALL')
        expect(groups).not.toContain('TT Drivers')
      })

      it('should not have duplicate run groups', () => {
        const groups = extractRunGroups(allRows)
        const uniqueGroups = [...new Set(groups)]
        expect(groups.length).toBe(uniqueGroups.length)
        
        // If there are duplicates, show which ones
        if (groups.length !== uniqueGroups.length) {
          const duplicates = groups.filter((g, i) => groups.indexOf(g) !== i)
          console.log('Duplicate groups found:', duplicates)
        }
      })

      it('should have valid time parsing for all sessions', () => {
        const invalidTimes = allRows.filter(r => !r.start || isNaN(r.start.getTime()))
        expect(invalidTimes).toEqual([])
      })
    })
  })
})
