const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'build.json');
const data = JSON.parse(fs.readFileSync(file));

// Parse current version
let [major, minor, patch] = data.version.split('.').map(Number);

const rawBump = (
  process.env.npm_config_bump ||
  process.env.BUILD_BUMP ||
  process.env.BUMP ||
  'patch'
).toLowerCase();

const bump = ['major', 'minor', 'patch'].includes(rawBump) ? rawBump : 'patch';

if (bump === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

// Compose new version
const newVersion = `${major}.${minor}.${patch}`;
data.version = newVersion;

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('Build version incremented to', newVersion, `(bump: ${bump})`);
