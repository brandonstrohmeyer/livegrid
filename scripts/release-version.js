#!/usr/bin/env node

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const {
  baseVersion,
  compareVersions,
  defaultBootstrapVersion,
  finalVersionFromRc,
  formatTag,
  nextRcVersion,
  parseTag,
  parseVersion
} = require('./version-utils')

const rootDir = path.resolve(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readPackageVersion() {
  const packageJson = readJson(packageJsonPath)
  parseVersion(packageJson.version)
  return baseVersion(packageJson.version)
}

function getGitTags(command) {
  try {
    const output = childProcess.execSync(command, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })

    return output
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(Boolean)
  } catch (err) {
    return []
  }
}

function parseTags(tags, { prerelease }) {
  return tags
    .map(tag => {
      try {
        return parseTag(tag)
      } catch (err) {
        return null
      }
    })
    .filter(Boolean)
    .filter(entry => (prerelease ? entry.parsed.rc !== null : entry.parsed.rc === null))
    .sort((left, right) => compareVersions(left.parsed, right.parsed))
}

function getLatestFinalVersion() {
  const releases = parseTags(getGitTags('git tag --list "v*"'), { prerelease: false })
  if (releases.length) {
    return releases[releases.length - 1].version
  }
  return readPackageVersion() || defaultBootstrapVersion
}

function getLatestMergedRcTag() {
  const prereleases = parseTags(getGitTags('git tag --merged HEAD --list "v*"'), { prerelease: true })
  return prereleases.length ? prereleases[prereleases.length - 1] : null
}

function printUsage() {
  console.error('Usage: node scripts/release-version.js <next-rc|latest-merged-rc|latest-merged-rc-tag|final-from-merged-rc|final-tag-from-merged-rc> [bump]')
}

function main() {
  const [, , command, value] = process.argv

  if (!command) {
    printUsage()
    process.exit(1)
  }

  if (command === 'next-rc') {
    if (!value) {
      throw new Error('next-rc requires a bump type')
    }
    const latestFinalVersion = getLatestFinalVersion()
    const latestMergedRc = getLatestMergedRcTag()
    const version = nextRcVersion(latestFinalVersion, latestMergedRc?.version || null, value)
    process.stdout.write(`${version}\n`)
    return
  }

  if (command === 'latest-merged-rc') {
    const latestMergedRc = getLatestMergedRcTag()
    if (!latestMergedRc) {
      throw new Error('No merged RC tag found on the current commit')
    }
    process.stdout.write(`${latestMergedRc.version}\n`)
    return
  }

  if (command === 'latest-merged-rc-tag') {
    const latestMergedRc = getLatestMergedRcTag()
    if (!latestMergedRc) {
      throw new Error('No merged RC tag found on the current commit')
    }
    process.stdout.write(`${latestMergedRc.tag}\n`)
    return
  }

  if (command === 'final-from-merged-rc') {
    const latestMergedRc = getLatestMergedRcTag()
    if (!latestMergedRc) {
      throw new Error('No merged RC tag found on the current commit')
    }
    process.stdout.write(`${finalVersionFromRc(latestMergedRc.version)}\n`)
    return
  }

  if (command === 'final-tag-from-merged-rc') {
    const latestMergedRc = getLatestMergedRcTag()
    if (!latestMergedRc) {
      throw new Error('No merged RC tag found on the current commit')
    }
    process.stdout.write(`${formatTag(finalVersionFromRc(latestMergedRc.version))}\n`)
    return
  }

  printUsage()
  process.exit(1)
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
