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
