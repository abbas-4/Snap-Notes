// Checks that a GitHub Pages site for this repository serves what it is supposed to.
//
// .github/workflows/deploy-pages.yml assembles the site according to its PUBLISH switch:
//   legacy  the original single-file app (legacy/index.html) at the site root
//   app     the Vite production build at the root, the original app at /legacy/index.html
//
// Directory mode, for an assembled _site/ or a bare dist/:
//   node scripts/verify-site.mjs <dir> --expect app|legacy [--no-legacy]
//
// URL mode, for the live site after a deployment:
//   node scripts/verify-site.mjs --url <site root url> --expect app|legacy [--retries N] [--delay seconds]
//
// Options:
//   --expect app|legacy   what the site root must serve (required)
//   --no-legacy           app mode only: do not require legacy/index.html (a bare dist/ has none)
//   --retries N           run the checks again up to N times after a failure (default 0)
//   --delay seconds       pause between attempts (default 15); Pages can take a moment to propagate
//
// Prints one "OK" line per check and one "FAIL" line per problem, and exits 0 only when every
// check passed. No dependencies: it runs on the plain Node from .nvmrc.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

// SHA-256 of the original app, the same constant scripts/verify-legacy.mjs checks.
const LEGACY_SHA256 = '899e4e3d5cab68348cb37a2b84767633c1ee70633310e8c1472b364f6b5043d6';

// Vite's `base` in vite.config.ts; built assets are referenced as /Snap-Notes/assets/<name>.
const BASE_PATH = '/Snap-Notes/';
const ASSETS_PREFIX = `${BASE_PATH}assets/`;

const USAGE = `Usage:
  node scripts/verify-site.mjs <dir> --expect app|legacy [--no-legacy]
  node scripts/verify-site.mjs --url <site root url> --expect app|legacy [--retries N] [--delay seconds]`;

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        expect: { type: 'string' },
        'no-legacy': { type: 'boolean', default: false },
        retries: { type: 'string', default: '0' },
        delay: { type: 'string', default: '15' },
      },
    });
  } catch (error) {
    usageError(error.message);
  }
  const { values, positionals } = parsed;

  if (values.expect !== 'app' && values.expect !== 'legacy') {
    usageError("--expect must be 'app' or 'legacy'");
  }
  if (positionals.length > 1) usageError(`Unexpected arguments: ${positionals.slice(1).join(' ')}`);
  if ((positionals.length === 1) === Boolean(values.url)) {
    usageError('Give either a directory or --url, not both');
  }

  const retries = Number(values.retries);
  const delay = Number(values.delay);
  if (!Number.isInteger(retries) || retries < 0) usageError('--retries must be a whole number');
  if (!Number.isFinite(delay) || delay < 0) usageError('--delay must be a number of seconds');

  return {
    dir: positionals[0],
    url: values.url,
    expect: values.expect,
    requireLegacy: !values['no-legacy'],
    retries,
    delay,
  };
}

// Both kinds of site expose the same shape, so the checks do not care where the bytes come
// from: `index` and `legacyIndex` locate the two HTML pages, `asset()` turns an absolute site
// path such as /Snap-Notes/assets/index-abc.js into a location, and `read()` fetches one.
// `read()` resolves to { body } or { error } instead of throwing, so a missing file is reported
// like any other failed check.
function directorySite(dir) {
  return {
    index: join(dir, 'index.html'),
    legacyIndex: join(dir, 'legacy', 'index.html'),
    asset: (sitePath) => join(dir, sitePath.slice(BASE_PATH.length)),
    async read(location) {
      try {
        return { body: await readFile(location) };
      } catch (error) {
        return { error: error.code === 'ENOENT' ? 'does not exist' : error.message };
      }
    },
  };
}

function urlSite(siteRoot) {
  const root = new URL(siteRoot);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return {
    // The root is fetched as a visitor would load it, not as <root>/index.html.
    index: root.href,
    legacyIndex: new URL('legacy/index.html', root).href,
    asset: (sitePath) => new URL(sitePath, root.origin).href,
    async read(location) {
      try {
        // Pages sits behind a CDN; without this a stale cached copy could pass or fail the run.
        const response = await fetch(location, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) return { error: `HTTP ${response.status}` };
        return { body: Buffer.from(await response.arrayBuffer()) };
      } catch (error) {
        return { error: error.cause?.message ?? error.message };
      }
    },
  };
}

// Pulls every <script src> and <link href> that points into the built assets folder, tagging
// stylesheets so the caller can insist on at least one script and one stylesheet.
function assetReferences(html) {
  const references = [];
  for (const [, tagName, attributeText] of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attributes = parseAttributes(attributeText);
    const isScript = tagName.toLowerCase() === 'script';
    const sitePath = isScript ? attributes.src : attributes.href;
    if (!sitePath || !sitePath.startsWith(ASSETS_PREFIX)) continue;
    const isStylesheet = !isScript && (attributes.rel ?? '').toLowerCase() === 'stylesheet';
    references.push({ sitePath, kind: isScript ? 'script' : isStylesheet ? 'stylesheet' : 'link' });
  }
  return references;
}

function parseAttributes(text) {
  const attributes = {};
  const attributePattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const [, name, doubleQuoted, singleQuoted, bare] of text.matchAll(attributePattern)) {
    attributes[name.toLowerCase()] = doubleQuoted ?? singleQuoted ?? bare ?? '';
  }
  return attributes;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Runs every check once. Returns true when all of them passed.
async function verify(site, options) {
  let passed = true;
  const ok = (message) => console.log(`OK    ${message}`);
  const fail = (message) => {
    console.log(`FAIL  ${message}`);
    passed = false;
  };

  const checkLegacyHash = (location, body) => {
    const hash = sha256(body);
    if (hash === LEGACY_SHA256) ok(`${location} is byte-for-byte the original app`);
    else fail(`${location} has sha256 ${hash}, expected ${LEGACY_SHA256} (the original app)`);
  };

  const index = await site.read(site.index);
  if (index.error) {
    fail(`${site.index}: ${index.error}`);
    return false;
  }
  ok(`${site.index} loaded (${index.body.length} bytes)`);

  if (options.expect === 'legacy') {
    checkLegacyHash(site.index, index.body);
    return passed;
  }

  const html = index.body.toString('utf8');

  if (html.includes('<div id="root">')) ok(`${site.index} has the React root element`);
  else fail(`${site.index} has no <div id="root">, so the React app cannot mount`);

  // The repository's root index.html is Vite's dev shell: it loads /src/main.tsx, which only
  // the dev server can serve. Publishing it is the exact mistake this script exists to catch.
  if (html.includes('/src/') || html.includes('.tsx')) {
    fail(
      `${site.index} references /src/ or .tsx: it is the Vite dev shell, not a production build`,
    );
  } else {
    ok(`${site.index} does not reference /src/ or .tsx`);
  }

  const references = assetReferences(html);
  const scripts = references.filter((reference) => reference.kind === 'script');
  const stylesheets = references.filter((reference) => reference.kind === 'stylesheet');
  if (scripts.length > 0)
    ok(`${site.index} loads ${scripts.length} script(s) from ${ASSETS_PREFIX}`);
  else fail(`${site.index} loads no <script src="${ASSETS_PREFIX}..."> at all`);
  if (stylesheets.length > 0) {
    ok(`${site.index} loads ${stylesheets.length} stylesheet(s) from ${ASSETS_PREFIX}`);
  } else {
    fail(`${site.index} loads no <link rel="stylesheet" href="${ASSETS_PREFIX}..."> at all`);
  }

  for (const reference of references) {
    const location = site.asset(reference.sitePath);
    const asset = await site.read(location);
    if (asset.error) fail(`${reference.kind} ${location}: ${asset.error}`);
    else if (asset.body.length === 0) fail(`${reference.kind} ${location} is empty`);
    else ok(`${reference.kind} ${location} (${asset.body.length} bytes)`);
  }

  if (options.requireLegacy) {
    const legacy = await site.read(site.legacyIndex);
    if (legacy.error) fail(`${site.legacyIndex}: ${legacy.error}`);
    else checkLegacyHash(site.legacyIndex, legacy.body);
  }

  return passed;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const site = options.url ? urlSite(options.url) : directorySite(options.dir);
  const target = options.url ? site.index : options.dir;
  const attempts = options.retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      console.log(`\nRetrying in ${options.delay}s (attempt ${attempt} of ${attempts})...`);
      await sleep(options.delay * 1000);
    }
    console.log(`Verifying ${target} (expecting ${options.expect})`);
    if (await verify(site, options)) {
      console.log(`\nAll checks passed: ${target} serves the ${options.expect} site.`);
      return;
    }
  }

  console.log(`\nVerification failed: ${target} does not serve the ${options.expect} site.`);
  process.exit(1);
}

await main();
