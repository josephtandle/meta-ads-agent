"use strict";

/**
 * Tamper evidence for the safety gates.
 *
 * config/src-checksums.json holds a sha256 per file under src/ and recipes/,
 * written by scripts/write-src-checksums.js at ship time. `doctor` recomputes
 * the hashes and reports any file that was edited, added or removed, so an
 * assistant that "fixes" a refusal by editing the write gate leaves a mark.
 * This is a cheap check, not a security boundary: anyone who edits src/ can
 * also rerun the script. It exists so the drift is visible, not impossible.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHECKSUM_PATH = path.join(ROOT, "config/src-checksums.json");
const TRACKED_DIRS = ["src", "recipes"];
const TRACKED_FILE = /\.(js|json)$/;

function listTrackedFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TRACKED_FILE.test(entry.name)) files.push(full);
    }
  };
  for (const dir of TRACKED_DIRS) walk(path.join(root, dir));
  return files.map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function computeSrcChecksums(root = ROOT) {
  const files = {};
  for (const relative of listTrackedFiles(root)) {
    files[relative] = sha256File(path.join(root, relative));
  }
  return { algorithm: "sha256", tracked: TRACKED_DIRS, files };
}

function readShippedChecksums(checksumPath = CHECKSUM_PATH) {
  if (!fs.existsSync(checksumPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(checksumPath, "utf8"));
    return parsed && typeof parsed.files === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const DIFFER_MESSAGE = "src files differ from the shipped version; the safety gates may have been edited. Restore the shipped files or reinstall before trusting write commands.";

function checkSrcIntegrity({ root = ROOT, checksumPath = CHECKSUM_PATH } = {}) {
  const shipped = readShippedChecksums(checksumPath);
  if (!shipped) {
    return {
      ok: false,
      changed: [],
      message: "config/src-checksums.json is missing or unreadable, so the installed src files cannot be verified against the shipped version.",
    };
  }
  const current = computeSrcChecksums(root).files;
  const changed = [];
  for (const [file, hash] of Object.entries(shipped.files)) {
    if (current[file] === undefined) changed.push(`${file} (missing)`);
    else if (current[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(current)) {
    if (shipped.files[file] === undefined) changed.push(`${file} (added)`);
  }
  changed.sort();
  return {
    ok: changed.length === 0,
    changed,
    message: changed.length === 0
      ? `All ${Object.keys(shipped.files).length} shipped src and recipe files match their checksums.`
      : DIFFER_MESSAGE,
  };
}

function writeSrcChecksums({ root = ROOT, checksumPath = CHECKSUM_PATH } = {}) {
  const manifest = computeSrcChecksums(root);
  fs.mkdirSync(path.dirname(checksumPath), { recursive: true });
  fs.writeFileSync(checksumPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

module.exports = {
  CHECKSUM_PATH,
  DIFFER_MESSAGE,
  checkSrcIntegrity,
  computeSrcChecksums,
  listTrackedFiles,
  writeSrcChecksums,
};
