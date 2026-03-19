import { describe, it, expect } from 'vitest'
import { parseNasaSeCsv } from './schedule/parsers/nasaSeParser.js'
import fs from 'fs'
import { loadFixtures } from './schedule/testing/fixtures.js'
import { log } from './logging.js'

describe('Multi-Schedule Validation', () => {
  const fixtures = loadFixtures('nasa-se')

  if (fixtures.length === 0) {
    it('should have CSV files in nasa-se fixtures directory', () => {
      expect(fixtures.length).toBeGreaterThan(0)
    })
    return
  }

  fixtures.forEach(fixture => {
    describe(fixture.label, () => {
      let schedule

      try {
        const csvContent = fs.readFileSync(fixture.filePath, 'utf-8')
        schedule = parseNasaSeCsv({ csvText: csvContent })
      } catch (err) {
        log.error('tests.parse_failed', { fixture: fixture.file }, err)
      }

      it('should parse without errors', () => {
        expect(schedule).toBeDefined()
        expect(schedule.warnings.length).toBe(0)
      })

      it('should detect at least one day', () => {
        expect(schedule.days.length).toBeGreaterThan(0)
      })

      it('should have on-track sessions', () => {
        expect(schedule.sessions.length).toBeGreaterThan(0)
      })

      it('should extract run groups without errors', () => {
        expect(schedule.runGroups).toContain('All')
        expect(schedule.runGroups.length).toBeGreaterThan(1)
      })

      it('should not have invalid groups (just numbers, TT ALL, TT Drivers)', () => {
        const justNumbers = schedule.runGroups.filter(g => /^\d+\*?$/.test(g))
        expect(justNumbers).toEqual([])
        expect(schedule.runGroups).not.toContain('TT ALL')
        expect(schedule.runGroups).not.toContain('TT Drivers')
      })

      it('should not have duplicate run groups', () => {
        const uniqueGroups = [...new Set(schedule.runGroups)]
        expect(schedule.runGroups.length).toBe(uniqueGroups.length)
      })

      it('should have valid time parsing for all sessions', () => {
        const invalidTimes = schedule.sessions.filter(r => !r.start || isNaN(r.start.getTime()))
        expect(invalidTimes).toEqual([])
      })
    })
  })
})
