#!/usr/bin/env node
/**
 * Switches the CLI's @delegance/sdk dependency between its two forms.
 *
 *   local    "file:../sdk"   monorepo development (the sibling sdk/ source)
 *   publish  "^<sdk version>" what the npm registry and the tarball carry
 *
 * npm runs this from the lifecycle hooks in cli/package.json, so a plain
 * `npm pack` or `npm publish` ships the semver range with no manual edit:
 *
 *   prepack      publish          rewrite before the tarball is built
 *   postpack     local-after-pack restore, EXCEPT under `npm publish`
 *   postpublish  local            restore once the registry has the version
 *
 * Why postpack skips the restore under publish: `npm publish` re-reads
 * package.json AFTER pack (and so after postpack) and sends that manifest to
 * the registry. Restoring in postpack would publish "file:../sdk" in the
 * registry metadata while the tarball said "^0.2.0". The restore waits for
 * postpublish instead. If a publish fails part way, run
 * `node scripts/sdk-dep.cjs local` (the working tree shows the diff).
 *
 *   check-published  refuse unless the registry already has the SDK version
 *                    this CLI will depend on (prepublishOnly runs it, so the
 *                    CLI can never be published ahead of its SDK).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI_PKG = path.join(__dirname, '..', 'package.json');
const SDK_PKG = path.join(__dirname, '..', '..', 'sdk', 'package.json');
const DEP = '@delegance/sdk';
const LOCAL_SPEC = 'file:../sdk';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sdkVersion() {
  if (!fs.existsSync(SDK_PKG)) return null;
  return readJson(SDK_PKG).version;
}

function writeSpec(spec) {
  const pkg = readJson(CLI_PKG);
  if (pkg.dependencies[DEP] === spec) return false;
  pkg.dependencies[DEP] = spec;
  fs.writeFileSync(CLI_PKG, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

function toPublish() {
  const current = readJson(CLI_PKG).dependencies[DEP];
  if (current !== LOCAL_SPEC) {
    // Already a registry range (a prior prepack, or the public export tree).
    console.log(`[sdk-dep] ${DEP} is "${current}", nothing to rewrite`);
    return;
  }
  const version = sdkVersion();
  if (!version) {
    console.error(`[sdk-dep] refusing: ${DEP} is "${LOCAL_SPEC}" but ${SDK_PKG} is missing`);
    process.exit(1);
  }
  writeSpec(`^${version}`);
  console.log(`[sdk-dep] ${DEP}: "${LOCAL_SPEC}" -> "^${version}" (publish form)`);
}

function toLocal() {
  const version = sdkVersion();
  const current = readJson(CLI_PKG).dependencies[DEP];
  // Only undo our own rewrite. A hand-set range stays as written.
  if (!version || current !== `^${version}`) return;
  writeSpec(LOCAL_SPEC);
  console.log(`[sdk-dep] ${DEP}: "^${version}" -> "${LOCAL_SPEC}" (restored)`);
}

function checkPublished() {
  const version = sdkVersion();
  if (!version) return;
  if (process.env.DELEGANCE_SKIP_SDK_PUBLISHED_CHECK === '1') {
    console.log('[sdk-dep] DELEGANCE_SKIP_SDK_PUBLISHED_CHECK=1, skipping the registry check');
    return;
  }
  let found = '';
  try {
    found = execFileSync('npm', ['view', `${DEP}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    found = '';
  }
  if (found !== version) {
    console.error(
      `[sdk-dep] refusing: ${DEP}@${version} is not on the npm registry yet. ` +
        'Publish the SDK first (cd ../sdk && npm publish), then publish the CLI.'
    );
    process.exit(1);
  }
  console.log(`[sdk-dep] ${DEP}@${version} is on the registry`);
}

const mode = process.argv[2];
switch (mode) {
  case 'publish':
    toPublish();
    break;
  case 'local':
    toLocal();
    break;
  case 'local-after-pack':
    if (process.env.npm_command === 'publish') {
      console.log('[sdk-dep] under npm publish: keeping the publish form until postpublish');
    } else {
      toLocal();
    }
    break;
  case 'check-published':
    checkPublished();
    break;
  default:
    console.error('usage: sdk-dep.cjs publish|local|local-after-pack|check-published');
    process.exit(2);
}
