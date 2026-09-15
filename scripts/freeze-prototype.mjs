import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'));
const hash = crypto.createHash('sha256').update(source).digest('hex');
const destination = path.join(root, 'prototype');
fs.mkdirSync(destination, { recursive: true });
const reference = path.join(destination, 'reference.html');
if (fs.existsSync(reference)) {
  const existing = crypto.createHash('sha256').update(fs.readFileSync(reference)).digest('hex');
  if (existing !== hash) throw new Error('Frozen prototype differs; do not overwrite the baseline.');
} else {
  fs.writeFileSync(reference, source, { flag: 'wx', mode: 0o444 });
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({
    source: 'index.html', reference: 'prototype/reference.html', sha256: hash,
    viewport: { width: 1440, height: 1000 },
    responsiveWidths: [980, 640], theme: 'clean browser default render',
    createdAt: new Date().toISOString(),
  }, null, 2));
}
console.log(`Frozen prototype verified: ${hash}`);
