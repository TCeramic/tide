const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const resedit = require('resedit');

const executable = process.argv[2] || 'release/win-unpacked/Tide.exe';
const expected = resedit.Data.IconFile.from(fs.readFileSync('build/icon.ico')).icons.map(item => item.data);
const resources = resedit.NtExecutableResource.from(resedit.NtExecutable.from(fs.readFileSync(executable)));
const groups = resedit.Resource.IconGroupEntry.fromEntries(resources.entries);
const hash = item => crypto.createHash('sha256').update(Buffer.from(item.isRaw() ? item.bin : item.generate())).digest('hex');
// ICO resource dimensions store 256 as zero.
const signatures = items => items.map(item => `${item.width || 256}x${item.height || 256}:${hash(item)}`).sort();
assert.ok(groups.length > 0, 'Executable has no icon resource');
for (const group of groups) assert.deepEqual(signatures(group.getIconItemsFromEntries(resources.entries)), signatures(expected), 'Executable icon differs from Tide artwork');
console.log('TIDE_EXECUTABLE_ICON_MATCHES_ALL_SIZES', expected.map(item => item.width).join(','));
