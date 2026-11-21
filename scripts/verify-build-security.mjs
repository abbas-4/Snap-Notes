// Checks a production build (dist/ or an assembled _site/) for security regressions before it
// is published:
//   * index.html carries the Content Security Policy and referrer policy from vite.config.ts;
//   * no file contains a secret: a Supabase secret or service-role key, an Anthropic API key,
//     or a private key (the publishable key and project URL are public by design);
//   * no source maps, .env files or other development files are published.
//
// Usage: node scripts/verify-build-security.mjs <dir>
// No dependencies: it runs on the plain Node from .nvmrc.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/verify-build-security.mjs <dir>');
  process.exit(2);
}

const SECRET_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{16,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// A JWT whose payload grants more than a signed-in user has.
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
const FORBIDDEN_FILES = [/\.map$/, /(^|\/)\.env/, /\.tsx?$/, /(^|\/)\.git\//, /\.sql$/];

let failed = false;
const fail = (message) => {
  console.error(`FAIL  ${message}`);
  failed = true;
};

async function* files(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

for await (const path of files(dir)) {
  const name = relative(dir, path);
  if (FORBIDDEN_FILES.some((pattern) => pattern.test(name))) fail(`${name} must not be published`);
  const text = (await readFile(path)).toString('latin1');
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) fail(`${name} contains what looks like a ${label}`);
  }
  for (const match of text.matchAll(JWT)) {
    try {
      const role = JSON.parse(Buffer.from(match[1], 'base64url').toString()).role;
      if (role !== 'anon' && role !== undefined) fail(`${name} contains a JWT with role "${role}"`);
    } catch {
      // Not a JWT after all.
    }
  }
}

const index = await readFile(join(dir, 'index.html'), 'utf8');
const decode = (value) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const rawCsp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)?.[1];
const csp = rawCsp === undefined ? undefined : decode(rawCsp);
if (!csp) fail('index.html has no Content-Security-Policy meta tag');
else {
  for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'"]) {
    if (!csp.includes(directive)) fail(`the Content Security Policy lacks ${directive}`);
  }
  if (/unsafe-inline|unsafe-eval|\*/.test(csp.replace(/https:\/\/[^\s;]+/g, ''))) {
    fail('the Content Security Policy allows unsafe-inline, unsafe-eval or a wildcard');
  }
  // The policy must be the first thing in <head>, before any script or stylesheet.
  if (index.indexOf('Content-Security-Policy') > index.search(/<script|<link/)) {
    fail('the Content Security Policy comes after a script or stylesheet');
  }
}
if (!/<meta name="referrer" content="no-referrer"/.test(index)) {
  fail('index.html has no referrer policy');
}

if (failed) process.exit(1);
console.log(`OK    ${dir}: security policy present, no secrets or development files found`);
