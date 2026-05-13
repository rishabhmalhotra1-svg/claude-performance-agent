'use strict';

/**
 * Parses uploaded KAM activity CSV files from the data/ directory.
 * Expects up to 2 CSV files placed in data/ before 11:30 AM IST.
 *
 * Columns expected (flexible matching):
 *   KAM Name/Email, Yesterday Calls, Yesterday Visits,
 *   MTD Calls, MTD Visits, Avg Daily Calls, Avg Daily Visits,
 *   Leads, Appts, Insps, File, DCF Form, DCF/DSA Onboarding,
 *   Disbursal, PR, SI
 */

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Column aliases ───────────────────────────────────────────────────────────

const COL = {
  kam:            ['kam', 'kam_name', 'name', 'email', 'kam_email', 'executive'],
  ydayCalls:      ['yesterday_calls', 'yday_calls', 'calls_yesterday', 'prev_calls'],
  ydayVisits:     ['yesterday_visits', 'yday_visits', 'visits_yesterday', 'prev_visits'],
  mtdCalls:       ['mtd_calls', 'mtd_call', 'month_calls'],
  mtdVisits:      ['mtd_visits', 'mtd_visit', 'month_visits'],
  avgCalls:       ['avg_daily_calls', 'avg_calls', 'average_calls'],
  avgVisits:      ['avg_daily_visits', 'avg_visits', 'average_visits'],
  leads:          ['leads', 'lead'],
  appts:          ['appts', 'appointments', 'appointment'],
  insps:          ['insps', 'inspections', 'inspection'],
  file:           ['file', 'files'],
  dcfForm:        ['dcf_form', 'dcf form', 'dcf'],
  dcfOnboarding:  ['dcf_dsa_onboarding', 'dcf/dsa_onboarding', 'onboarding', 'dsa_onboarding'],
  disbursal:      ['disbursal', 'disbursals', 'disbursed'],
  pr:             ['pr'],
  si:             ['si', 'stock_in', 'stock_ins'],
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\/\-]+/g, '_').trim();
}

function resolveHeader(headers, field) {
  const aliases = COL[field] || [field];
  for (const alias of aliases) {
    const found = headers.find((h) => norm(h) === alias || norm(h).includes(alias));
    if (found) return found;
  }
  return null;
}

function parseCSVText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  // Simple CSV split (handles quoted fields)
  function splitLine(line) {
    const cols = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  }

  const headers = splitLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.every((c) => !c)) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
    rows.push(row);
  }

  return { headers, rows };
}

function mergeCSVData(datasets) {
  // Merge multiple CSV datasets by KAM name/email
  const kamMap = {};

  for (const { headers, rows } of datasets) {
    const kamCol = resolveHeader(headers, 'kam');

    rows.forEach((row) => {
      const kamKey = (row[kamCol] || '').trim();
      if (!kamKey) return;

      if (!kamMap[kamKey]) {
        kamMap[kamKey] = { kam: kamKey };
      }

      // Merge all fields
      Object.keys(COL).forEach((field) => {
        const col = resolveHeader(headers, field);
        if (col && row[col] !== undefined && row[col] !== '') {
          kamMap[kamKey][field] = row[col];
        }
      });
    });
  }

  return Object.values(kamMap);
}

function readCSVFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const files = fs.readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.csv'));

  if (files.length === 0) {
    logger.info('No CSV files found in data/ directory');
    return null;
  }

  logger.info(`Found ${files.length} CSV file(s): ${files.join(', ')}`);

  const datasets = [];
  for (const file of files.slice(0, 2)) { // max 2 files
    try {
      const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const parsed = parseCSVText(text);
      if (parsed && parsed.rows.length > 0) {
        datasets.push(parsed);
        logger.info(`Parsed ${parsed.rows.length} rows from ${file}`);
      }
    } catch (err) {
      logger.error(`Failed to parse ${file}: ${err.message}`);
    }
  }

  if (datasets.length === 0) return null;

  const merged = mergeCSVData(datasets);
  logger.info(`Merged data for ${merged.length} KAMs`);
  return merged;
}

function archiveCSVFiles() {
  if (!fs.existsSync(DATA_DIR)) return;
  const archiveDir = path.join(DATA_DIR, 'archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  const files = fs.readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.csv'));
  const stamp = new Date().toISOString().slice(0, 10);
  files.forEach((f) => {
    fs.renameSync(
      path.join(DATA_DIR, f),
      path.join(archiveDir, `${stamp}_${f}`)
    );
  });
  if (files.length) logger.info(`Archived ${files.length} CSV file(s)`);
}

module.exports = { readCSVFiles, archiveCSVFiles };
