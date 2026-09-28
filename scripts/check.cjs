const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version, 'manifest and package versions differ');
assert.deepEqual(manifest.permissions, ['storage', 'contextMenus', 'alarms']);
assert.equal(manifest.host_permissions, undefined, 'no host permissions needed');
const referenced = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css])];
for (const file of referenced) assert.ok(fs.existsSync(path.join(root, file)), `Missing ${file}`);
for (const file of fs.readdirSync(root).filter(n => n.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}
console.log('Manifest references, minimal permissions and JavaScript syntax OK');
