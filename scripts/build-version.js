#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const buildJsonPath = path.join(rootDir, 'build.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const defaultBootstrapVersion = '0.2.24';
const validBumps = new Set(['major', 'minor', 'patch']);

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBuildJsonVersion() {
  if (!fs.existsSync(buildJsonPath)) return null;
  const data = readJson(buildJsonPath);
  parseSemver(data.version);
  return data.version;
}

function readPackageVersion() {
  const packageJson = readJson(packageJsonPath);
  parseSemver(packageJson.version);
  return packageJson.version;
}

function getLatestGitTagVersion() {
  try {
    const output = childProcess.execSync('git tag --list "v[0-9]*.[0-9]*.[0-9]*"', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });

    const versions = output
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(Boolean)
      .map(tag => tag.replace(/^v/, ''))
      .map(version => ({ raw: version, parsed: parseSemver(version) }))
      .sort((left, right) => compareSemver(left.parsed, right.parsed));

    return versions.length ? versions[versions.length - 1].raw : null;
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
        parseSemver(version);
        return { version, source };
      }
    } catch (err) {
      continue;
    }
  }

  throw new Error('Unable to resolve a build version');
}

function bumpVersion(version, bump) {
  if (!validBumps.has(bump)) {
    throw new Error(`Invalid bump "${bump}". Expected major, minor, or patch.`);
  }

  const next = parseSemver(version);
  if (bump === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (bump === 'minor') {
    next.minor += 1;
    next.patch = 0;
  } else {
    next.patch += 1;
  }

  return formatSemver(next);
}

function writeBuildVersion(version) {
  parseSemver(version);
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
