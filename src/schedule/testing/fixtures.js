import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolveParserFixturesDir(parserId) {
  return path.resolve(__dirname, '..', 'parsers', parserId, 'fixtures')
}

export function loadFixtureManifest(parserId) {
  const fixturesDir = resolveParserFixturesDir(parserId)
  const manifestPath = path.join(fixturesDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Fixture manifest not found for parser "${parserId}".`)
  }
  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(manifestRaw)
  return { fixturesDir, manifest }
}

export function loadFixtures(parserId) {
  const { fixturesDir, manifest } = loadFixtureManifest(parserId)
  const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : []

  return fixtures.map(fixture => ({
    file: fixture.file,
    label: fixture.label || fixture.file,
    overrides: fixture.overrides || {},
    filePath: path.join(fixturesDir, fixture.file)
  }))
}
