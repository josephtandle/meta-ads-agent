#!/usr/bin/env node
"use strict";

/**
 * Regenerates config/src-checksums.json from the files under src/ and recipes/.
 * Run this as the LAST step of any shipped change to src or recipes; the
 * integrity test fails when the manifest is stale and `doctor` reports the
 * drift to the user.
 *
 *   node scripts/write-src-checksums.js          # write the manifest
 *   node scripts/write-src-checksums.js --check  # exit 1 if it is stale
 */

const { checkSrcIntegrity, writeSrcChecksums, CHECKSUM_PATH } = require("../src/integrity");

if (process.argv.includes("--check")) {
  const result = checkSrcIntegrity();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const manifest = writeSrcChecksums();
console.log(`Wrote ${Object.keys(manifest.files).length} checksums to ${CHECKSUM_PATH}`);
