// Confirms that files are byte-for-byte identical to the preserved original app: index.html as
// of commit 25ff73a (sha256 899e4e3d…6b5043d6, the version live on GitHub Pages before the
// rebuild), plus the security patch described in docs/SECURITY_AUDIT.md (HTML escaping of card
// fields and IDs, a Content Security Policy, and Subresource Integrity for its stylesheet).
// Its behaviour and its data are otherwise unchanged. Any other change makes this check fail.
//
// Usage: node scripts/verify-legacy.mjs [file ...]   (defaults to legacy/index.html)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ORIGINAL_SHA256 = 'dc14fd5c704eb2c7d785bed49b15a77785ed07a520e84064dd1c5420130db8cd';

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
