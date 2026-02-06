import { describe, it, expect } from 'vitest'
import { nasaSeGroupTaxonomy } from './nasa-se/groupTaxonomy.js'
import { expandSelectedGroups } from '../testing/groupMapping.js'

describe('NASA-SE Group Taxonomy Mapping', () => {
  it('expands TT parent selection to TT Alpha/Omega', () => {
    const expanded = expandSelectedGroups(['TT'], nasaSeGroupTaxonomy, [])
    expect(expanded).toContain('TT Alpha')
    expect(expanded).toContain('TT Omega')
  })

  it('adds TT parent when TT Omega is selected', () => {
    const expanded = expandSelectedGroups(['TT Omega'], nasaSeGroupTaxonomy, [])
    expect(expanded).toContain('TT')
  })

  it('maps All Time Trial label when TT Omega is selected', () => {
    const scheduleRunGroups = ['All Time Trial', 'TT Alpha', 'TT Omega']
    const expanded = expandSelectedGroups(['TT Omega'], nasaSeGroupTaxonomy, scheduleRunGroups)
    expect(expanded).toContain('All Time Trial')
  })

  it('maps Mock Race and All Racers Warmup labels when race groups are selected', () => {
    const scheduleRunGroups = ['Mock Race', 'All Racers Warmup', 'Thunder Race', 'Lightning Race']
    const expanded = expandSelectedGroups(['Thunder Race'], nasaSeGroupTaxonomy, scheduleRunGroups)
    expect(expanded).toContain('Mock Race')
    expect(expanded).toContain('All Racers Warmup')
  })
})
