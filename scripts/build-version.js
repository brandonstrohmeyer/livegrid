#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const {
  bumpVersion,
  compareVersions,
  defaultBootstrapVersion,
  parseTag,
  parseVersion
} = require('./version-utils');

const rootDir = path.resolve(__dirname, '..');
const buildJsonPath = path.join(rootDir, 'build.json');
const packageJsonPath = path.join(rootDir, 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBuildJsonVersion() {
  if (!fs.existsSync(buildJsonPath)) return null;
  const data = readJson(buildJsonPath);
  parseVersion(data.version);
  return data.version;
}

function readPackageVersion() {
  const packageJson = readJson(packageJsonPath);
  parseVersion(packageJson.version);
  return packageJson.version;
}

function getLatestGitTagVersion() {
  try {
    const output = childProcess.execSync('git tag --list "v*"', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });

    const versions = output
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(Boolean)
      .map(tag => {
        try {
          return parseTag(tag);
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean)
      .filter(tag => tag.parsed.rc === null)
      .sort((left, right) => compareVersions(left.parsed, right.parsed));

    return versions.length ? versions[versions.length - 1].version : null;
  } catch (err) {
    return null;
  }
}

function resolveCurrentVersion() {
  const candidates = [
    ['build.json', () => readBuildJsonVersion()],
    ['git tag', () => getLatestGitTagVersion()],
    ['package.json', () => readPackageVersion()],
    ['default', () => defaultBootstrapVersion]
  ];

  for (const [source, getter] of candidates) {
    try {
      const version = getter();
      if (version) {
        parseVersion(version);
        return { version, source };
      }
    } catch (err) {
      continue;
    }
  }

  throw new Error('Unable to resolve a build version');
}

function writeBuildVersion(version) {
  parseVersion(version);
  fs.writeFileSync(buildJsonPath, JSON.stringify({ version }, null, 2) + '\n');
}

function printUsage() {
  console.error('Usage: node scripts/build-version.js <current|ensure|set|next|bump> [value]');
}

function main() {
  const [, , command, value] = process.argv;

  if (!command) {
    printUsage();
    process.exit(1);
  }

  if (command === 'current') {
    const resolved = resolveCurrentVersion();
    process.stdout.write(`${resolved.version}\n`);
    return;
  }

  if (command === 'ensure') {
    const existing = fs.existsSync(buildJsonPath) ? readBuildJsonVersion() : null;
    if (existing) {
      process.stdout.write(`${existing}\n`);
      return;
    }

    const resolved = resolveCurrentVersion();
    writeBuildVersion(resolved.version);
    process.stdout.write(`${resolved.version}\n`);
    return;
  }

  if (command === 'set') {
    if (!value) {
      throw new Error('set requires a semver version');
    }
    writeBuildVersion(value);
    process.stdout.write(`${value}\n`);
    return;
  }

  if (command === 'next') {
    if (!value) {
      throw new Error('next requires a bump type');
    }
    const resolved = resolveCurrentVersion();
    const nextVersion = bumpVersion(resolved.version, value);
    process.stdout.write(`${nextVersion}\n`);
    return;
  }

  if (command === 'bump') {
    if (!value) {
      throw new Error('bump requires a bump type');
    }
    const resolved = resolveCurrentVersion();
    const nextVersion = bumpVersion(resolved.version, value);
    writeBuildVersion(nextVersion);
    process.stdout.write(`${nextVersion}\n`);
    return;
  }

  printUsage();
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
