const defaultBootstrapVersion = '0.2.24'
const validBumps = new Set(['major', 'minor', 'patch'])
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/

function parseVersion(value) {
  const match = versionPattern.exec(String(value || '').trim())
  if (!match) {
    throw new Error(`Invalid semver version: ${value}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4])
  }
}

function parseVersionObject(version) {
  if (!version || typeof version !== 'object') {
    throw new Error(`Invalid semver version: ${version}`)
  }

  const { major, minor, patch, rc = null } = version
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new Error(`Invalid semver version: ${JSON.stringify(version)}`)
  }
  if (rc !== null && !Number.isInteger(rc)) {
    throw new Error(`Invalid semver version: ${JSON.stringify(version)}`)
  }

  return { major, minor, patch, rc }
}

function formatVersion(version) {
  const parsed = typeof version === 'string' ? parseVersion(version) : parseVersionObject(version)
  const suffix = parsed.rc === null ? '' : `-rc.${parsed.rc}`
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${suffix}`
}

function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : parseVersionObject(left)
  const b = typeof right === 'string' ? parseVersion(right) : parseVersionObject(right)

  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  if (a.rc === b.rc) return 0
  if (a.rc === null) return 1
  if (b.rc === null) return -1
  return a.rc - b.rc
}

function compareBaseVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : parseVersionObject(left)
  const b = typeof right === 'string' ? parseVersion(right) : parseVersionObject(right)
  return compareVersions({ ...a, rc: null }, { ...b, rc: null })
}

function bumpVersion(version, bump) {
  if (!validBumps.has(bump)) {
    throw new Error(`Invalid bump "${bump}". Expected major, minor, or patch.`)
  }

  const next = typeof version === 'string' ? parseVersion(version) : parseVersionObject(version)
  next.rc = null

  if (bump === 'major') {
    next.major += 1
    next.minor = 0
    next.patch = 0
  } else if (bump === 'minor') {
    next.minor += 1
    next.patch = 0
  } else {
    next.patch += 1
  }

  return formatVersion(next)
}

function baseVersion(version) {
  const parsed = typeof version === 'string' ? parseVersion(version) : parseVersionObject(version)
  return formatVersion({ ...parsed, rc: null })
}

function parseTag(tag) {
  const raw = String(tag || '').trim()
  if (!raw.startsWith('v')) {
    throw new Error(`Invalid release tag: ${tag}`)
  }
  const version = raw.slice(1)
  const parsed = parseVersion(version)
  return {
    tag: raw,
    version: formatVersion(parsed),
    parsed
  }
}

function formatTag(version) {
  return `v${formatVersion(version)}`
}

function nextRcVersion(latestFinalVersion, latestRcVersion, bump) {
  const baseline = baseVersion(latestFinalVersion || defaultBootstrapVersion)
  const candidateBase = bumpVersion(baseline, bump)

  if (!latestRcVersion) {
    return `${candidateBase}-rc.1`
  }

  const latestRc = typeof latestRcVersion === 'string' ? parseVersion(latestRcVersion) : parseVersionObject(latestRcVersion)
  if (latestRc.rc === null) {
    throw new Error(`RC version required: ${formatVersion(latestRc)}`)
  }

  if (compareBaseVersions(latestRc, candidateBase) >= 0) {
    return `${baseVersion(latestRc)}-rc.${latestRc.rc + 1}`
  }

  return `${candidateBase}-rc.1`
}

function finalVersionFromRc(rcVersion) {
  const parsed = typeof rcVersion === 'string' ? parseVersion(rcVersion) : parseVersionObject(rcVersion)
  if (parsed.rc === null) {
    throw new Error(`RC version required: ${formatVersion(parsed)}`)
  }
  return baseVersion(parsed)
}

module.exports = {
  baseVersion,
  bumpVersion,
  compareBaseVersions,
  compareVersions,
  defaultBootstrapVersion,
  finalVersionFromRc,
  formatTag,
  formatVersion,
  nextRcVersion,
  parseTag,
  parseVersion,
  validBumps
}
