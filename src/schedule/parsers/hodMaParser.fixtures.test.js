import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import { parseHodMaCsv } from './hodMaParser.js'
import { validateScheduleContract } from '../testing/contract.js'
import { loadFixtures } from '../testing/fixtures.js'
import { runAnomalyChecks } from '../testing/anomalyChecks.js'
import { hodMaGroupTaxonomy } from './hod-ma/groupTaxonomy.js'

const STRICT_MODE = process.env.LIVEGRID_TEST_STRICT === '1'

describe('HOD-MA Fixture Validation', () => {
  const fixtures = loadFixtures('hod-ma')
  const warningsSummary = []

  it('includes 10-20 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
    expect(fixtures.length).toBeLessThanOrEqual(20)
  })

  fixtures.forEach(fixture => {
    it(`validates fixture: ${fixture.label}`, () => {
      const csvText = fs.readFileSync(fixture.filePath, 'utf-8')
      const schedule = parseHodMaCsv({ csvText, sourceLabel: fixture.file })
      const { errors } = validateScheduleContract(schedule)

      expect(errors).toEqual([])

      const warnings = runAnomalyChecks({
        schedule,
        taxonomy: hodMaGroupTaxonomy,
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

    console.warn('\n[parser warnings] HOD-MA fixture anomalies detected:')
    console.table(summaryRows)

    warningsSummary.forEach(item => {
      console.warn(`\n${item.fixture}`)
      item.warnings.forEach(warning => {
        console.warn(`- [${warning.code}] ${warning.message}`)
      })
    })
  })
})
