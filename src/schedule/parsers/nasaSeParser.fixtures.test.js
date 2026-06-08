import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import { parseNasaSeCsv } from './nasaSeParser.js'
import { validateScheduleContract } from '../testing/contract.js'
import { loadFixtures } from '../testing/fixtures.js'
import { runAnomalyChecks } from '../testing/anomalyChecks.js'
import { nasaSeGroupTaxonomy } from './nasa-se/groupTaxonomy.js'
import { log } from '../../logging.js'

const STRICT_MODE = process.env.LIVEGRID_TEST_STRICT === '1'

describe('NASA-SE Fixture Validation', () => {
  const fixtures = loadFixtures('nasa-se')
  const warningsSummary = []

  it('includes 9-12 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9)
    expect(fixtures.length).toBeLessThanOrEqual(12)
  })

  it('keeps the second Sunday HPDE 1 session in 2026 Flatten The Curve', () => {
    const fixture = fixtures.find(item => item.label === '2026 Flatten The Curve')
    expect(fixture).toBeDefined()

    const csvText = fs.readFileSync(fixture.filePath, 'utf-8')
    const schedule = parseNasaSeCsv({ csvText })
    const sundayHpde1Sessions = schedule.sessions.filter(session =>
      session.day === 'Sunday' && session.runGroupIds.includes('HPDE 1')
    )

    expect(sundayHpde1Sessions.map(session => session.start.getHours())).toEqual([9, 10, 13, 16])
    expect(sundayHpde1Sessions.map(session => session.start.getMinutes())).toEqual([10, 40, 55, 5])
  })

  it('treats the Sunday TT All replacement row as both TT run groups', () => {
    const fixture = fixtures.find(item => item.label === '2026 Flatten The Curve')
    expect(fixture).toBeDefined()

    const csvText = fs.readFileSync(fixture.filePath, 'utf-8')
    const schedule = parseNasaSeCsv({ csvText })
    const ttAll = schedule.sessions.find(session =>
      session.day === 'Sunday' && session.session === 'TT All'
    )
    const zeroDurationTtOmega = schedule.sessions.find(session =>
      session.day === 'Sunday' &&
      session.session === 'TT Omega (TTU/b, 4-6)' &&
      session.start.getHours() === 15 &&
      session.start.getMinutes() === 25
    )

    expect(ttAll).toBeDefined()
    expect(ttAll.runGroupIds).toEqual(['TT Alpha', 'TT Omega'])
    expect(zeroDurationTtOmega).toBeUndefined()
  })

  fixtures.forEach(fixture => {
    it(`validates fixture: ${fixture.label}`, () => {
      const csvText = fs.readFileSync(fixture.filePath, 'utf-8')
      const schedule = parseNasaSeCsv({ csvText })
      const { errors } = validateScheduleContract(schedule)

      expect(errors).toEqual([])

      const warnings = runAnomalyChecks({
        schedule,
        taxonomy: nasaSeGroupTaxonomy,
        overrides: fixture.overrides
      })

      if (warnings.length > 0) {
        warningsSummary.push({
          fixture: fixture.label,
          warningCount: warnings.length,
          warnings
        })
      }

      if (STRICT_MODE) {
        expect(warnings).toEqual([])
      }
    })
  })

  afterAll(() => {
    if (warningsSummary.length === 0) return

    const summaryRows = warningsSummary.map(item => ({
      Fixture: item.fixture,
      Warnings: item.warningCount,
      Codes: [...new Set(item.warnings.map(w => w.code))].join(', ')
    }))

    log.warn('tests.parser_warnings', {
      parser: 'nasa-se',
      summary: summaryRows,
      warnings: warningsSummary
    })
  })
})
