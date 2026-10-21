// Confirms that files are byte-for-byte identical to the original app
// (index.html as of commit 25ff73a, the version live on GitHub Pages before the rebuild).
//
// Usage: node scripts/verify-legacy.mjs [file ...]   (defaults to legacy/index.html)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ORIGINAL_SHA256 = '899e4e3d5cab68348cb37a2b84767633c1ee70633310e8c1472b364f6b5043d6';

const files = process.argv.length > 2 ? process.argv.slice(2) : ['legacy/index.html'];
let failed = false;

for (const file of files) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (hash === ORIGINAL_SHA256) {
    console.log(`OK        ${file} matches the original app (sha256 ${hash})`);
  } else {
    console.error(`MISMATCH  ${file} has sha256 ${hash}, expected ${ORIGINAL_SHA256}`);
    failed = true;
  }
}

if (failed) process.exit(1);
