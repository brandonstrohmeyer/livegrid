import { describe, it, expect } from 'vitest'
import { hodMaGroupTaxonomy } from './hod-ma/groupTaxonomy.js'
import { expandSelectedGroups } from '../testing/groupMapping.js'

describe('HOD-MA Group Taxonomy Mapping', () => {
  it('expands C/D alias to include C/D label', () => {
    const scheduleRunGroups = ['C/D', 'C - Advanced', 'D - Expert']
    const expanded = expandSelectedGroups(['C - Advanced'], hodMaGroupTaxonomy, scheduleRunGroups)
    expect(expanded).toContain('C/D')
  })

  it('maps A1 label when A is selected', () => {
    const scheduleRunGroups = ['A1', 'A - Novice']
    const expanded = expandSelectedGroups(['A - Novice'], hodMaGroupTaxonomy, scheduleRunGroups)
    expect(expanded).toContain('A1')
  })
})
