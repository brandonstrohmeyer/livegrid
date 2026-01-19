const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'build.json');
const data = JSON.parse(fs.readFileSync(file));

// Parse current version
let [major, minor, patch] = data.version.split('.').map(Number);

// Increment patch
patch += 1;

// Compose new version
const newVersion = `${major}.${minor}.${patch}`;
data.version = newVersion;

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('Build version incremented to', newVersion);
