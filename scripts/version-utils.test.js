const { describe, expect, it } = require('vitest')
const {
  bumpVersion,
  compareVersions,
  finalVersionFromRc,
  formatTag,
  nextRcVersion,
  parseTag,
  parseVersion
} = require('./version-utils')

describe('version-utils', () => {
  it('parses final and rc versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, rc: null })
    expect(parseVersion('1.2.3-rc.4')).toEqual({ major: 1, minor: 2, patch: 3, rc: 4 })
  })

  it('treats final releases as newer than rc releases of the same base version', () => {
    expect(compareVersions('1.2.3-rc.2', '1.2.3')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3-rc.2')).toBeGreaterThan(0)
  })

  it('bumps prerelease versions from their base version', () => {
    expect(bumpVersion('1.2.3-rc.2', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3-rc.2', 'minor')).toBe('1.3.0')
  })

  it('continues an existing rc stream when later bumps are smaller', () => {
    expect(nextRcVersion('0.2.24', '0.3.0-rc.1', 'patch')).toBe('0.3.0-rc.2')
  })

  it('starts a new rc stream when the latest bump exceeds the current rc base', () => {
    expect(nextRcVersion('0.2.24', '0.2.25-rc.2', 'minor')).toBe('0.3.0-rc.1')
  })

  it('derives final releases from rc versions and formats tags', () => {
    expect(finalVersionFromRc('0.3.0-rc.2')).toBe('0.3.0')
    expect(parseTag('v0.3.0-rc.2').version).toBe('0.3.0-rc.2')
    expect(formatTag('0.3.0')).toBe('v0.3.0')
  })
})
