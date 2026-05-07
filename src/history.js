'use strict';

/**
 * Lightweight file-based history store for Day-vs-Day and Week-vs-Week
 * comparisons. Persists daily snapshots as JSON in logs/history/.
 */

const fs   = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'logs', 'history');

function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function dateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function filePath(key) {
  return path.join(HISTORY_DIR, `${key}.json`);
}

function save(report) {
  ensureDir();
  const key = dateKey(report.date || report.fetchedAt);
  const snapshot = {
    date: key,
    team: report.team,
    mtd: report.mtd,
    topPerformer: report.topPerformer ? { name: report.topPerformer.name, stockIns: report.topPerformer.stockIns } : null,
    kamSummary: (report.kams || []).map((k) => ({
      name: k.name, region: k.region, stockIns: k.stockIns, conversion: k.conversion,
    })),
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath(key), JSON.stringify(snapshot, null, 2));
}

function load(date) {
  ensureDir();
  const key = dateKey(date);
  const fp = filePath(key);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

/** Returns yesterday's snapshot (or null). */
function yesterday(referenceDate) {
  const d = new Date(referenceDate || Date.now());
  d.setDate(d.getDate() - 1);
  return load(d);
}

/** Returns the snapshot from 7 days ago (or null). */
function lastWeek(referenceDate) {
  const d = new Date(referenceDate || Date.now());
  d.setDate(d.getDate() - 7);
  return load(d);
}

module.exports = { save, load, yesterday, lastWeek };
