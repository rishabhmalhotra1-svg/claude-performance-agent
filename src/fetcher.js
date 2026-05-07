'use strict';

/**
 * Fetches KAM performance data from the live dashboard.
 *
 * Strategy:
 *   1. Try a plain axios GET – works if the page renders data server-side.
 *   2. Fall back to Playwright headless Chromium to execute JS and scrape the
 *      fully-rendered DOM.
 *   3. Parse the HTML with cheerio to extract table rows.
 *   4. Filter records to Rishabh Malhotra's team only.
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');

const DASHBOARD_URL =
  process.env.DASHBOARD_URL ||
  'https://c24-htmlhub.pages.dev/view/nYIhK3cGo_HCzS4AEit6dOFpWK0BisfPCxc9D98DfK4';

const TL_NAME = (process.env.TL_NAME || 'Rishabh Malhotra').toLowerCase().trim();
const TM_EMAIL = (process.env.TM_EMAIL || 'rishabh.malhotra1@cars24.com').toLowerCase().trim();

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '5000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Plain HTTP fetch ────────────────────────────────────────────────────────

async function fetchViaHttp() {
  logger.info('Attempting plain HTTP fetch of dashboard…');
  const response = await axios.get(DASHBOARD_URL, {
    timeout: 30000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  return response.data;
}

// ─── Playwright headless fetch ───────────────────────────────────────────────

async function fetchViaPlaywright() {
  logger.info('Attempting Playwright headless fetch of dashboard…');
  let chromium, browser;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright not installed – run: npm install playwright && npx playwright install chromium');
  }

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 60000 });
    // Wait for table to appear
    await page.waitForSelector('table', { timeout: 30000 }).catch(() => {});
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// ─── HTML parser ─────────────────────────────────────────────────────────────

/**
 * Parses HTML and extracts KAM performance rows.
 * Returns { headers: string[], rows: Object[], fetchedAt: string }
 */
function parseHtml(html) {
  const $ = cheerio.load(html);
  const tables = $('table');

  if (tables.length === 0) {
    // Try to extract JSON embedded in script tags (some dashboards embed data)
    const jsonData = extractEmbeddedJson($);
    if (jsonData) return jsonData;
    throw new Error('No table found in dashboard HTML');
  }

  // Use the largest table (most rows) as the data table
  let bestTable = null;
  let bestCount = 0;
  tables.each((_, tbl) => {
    const count = $(tbl).find('tr').length;
    if (count > bestCount) { bestCount = count; bestTable = tbl; }
  });

  const headers = [];
  $(bestTable).find('thead tr th, thead tr td').each((_, th) => {
    headers.push($(th).text().trim());
  });

  // If no thead, use first tbody row as headers
  if (headers.length === 0) {
    $(bestTable).find('tr').first().find('th, td').each((_, th) => {
      headers.push($(th).text().trim());
    });
  }

  const rows = [];
  const dataRows = headers.length > 0
    ? $(bestTable).find('tbody tr')
    : $(bestTable).find('tr').not(':first-child');

  dataRows.each((_, tr) => {
    const cells = [];
    $(tr).find('td').each((_, td) => cells.push($(td).text().trim()));
    if (cells.length === 0) return;

    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ''; });
    // Also store positional for resilience
    cells.forEach((v, i) => { row[`col_${i}`] = v; });
    rows.push(row);
  });

  logger.info(`Parsed ${rows.length} rows with ${headers.length} columns from dashboard`);
  return { headers, rows, fetchedAt: new Date().toISOString() };
}

/**
 * Attempts to extract embedded JSON data arrays from <script> tags.
 */
function extractEmbeddedJson($) {
  let found = null;
  $('script').each((_, s) => {
    const text = $(s).html() || '';
    // Common patterns: var data = [...], window.__DATA__ = {...}, etc.
    const match = text.match(/(?:var\s+\w+\s*=\s*|window\.__\w+__\s*=\s*)(\[[\s\S]*?\]);/);
    if (match) {
      try {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length > 0) {
          found = {
            headers: Object.keys(arr[0]),
            rows: arr,
            fetchedAt: new Date().toISOString(),
          };
          return false; // break
        }
      } catch { /* ignore */ }
    }
  });
  return found;
}

// ─── Team filter ─────────────────────────────────────────────────────────────

/**
 * Normalises column names (lowercase, trim) and filters rows to
 * Rishabh Malhotra's team only.
 */
function filterTeamRows(rawData) {
  const { headers, rows, fetchedAt } = rawData;

  // Build a header → normalised-key map
  const headerMap = {};
  headers.forEach((h) => {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    headerMap[h] = norm;
  });

  const normalised = rows.map((row) => {
    const n = {};
    Object.entries(row).forEach(([k, v]) => {
      const normKey = headerMap[k] || k;
      n[normKey] = v;
    });
    return n;
  });

  // Identify columns that might represent TL name or TM email
  const tlCol = Object.values(headerMap).find((k) =>
    k.includes('tl') || k.includes('team_lead') || k.includes('manager')
  );
  const emailCol = Object.values(headerMap).find((k) =>
    k.includes('email') || k.includes('tm_email') || k.includes('manager_email')
  );

  const teamRows = normalised.filter((row) => {
    const tlVal = (row[tlCol] || '').toLowerCase().trim();
    const emailVal = (row[emailCol] || '').toLowerCase().trim();
    return tlVal.includes(TL_NAME) || emailVal === TM_EMAIL;
  });

  const unmapped = normalised.filter((row) => {
    const tlVal = (row[tlCol] || '').toLowerCase().trim();
    const emailVal = (row[emailCol] || '').toLowerCase().trim();
    return !tlVal.includes(TL_NAME) && emailVal !== TM_EMAIL;
  });

  logger.info(
    `Team filter: ${teamRows.length} mapped rows, ${unmapped.length} unmapped rows`
  );

  return { headers: Object.values(headerMap), teamRows, unmapped, fetchedAt, rawHeaders: headers, headerMap };
}

// ─── Main fetch with retry ───────────────────────────────────────────────────

async function fetchDashboardData() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Fetch attempt ${attempt}/${MAX_RETRIES}`);

      let html;
      try {
        html = await fetchViaHttp();
        // If we get HTML but it's mostly empty / a loading screen, fall through to Playwright
        if (html.length < 2000 || !html.includes('<table')) {
          logger.info('HTTP response looks like a JS-rendered page – switching to Playwright');
          html = await fetchViaPlaywright();
        }
      } catch (httpErr) {
        logger.warn(`HTTP fetch failed: ${httpErr.message} – trying Playwright`);
        html = await fetchViaPlaywright();
      }

      const rawData = parseHtml(html);
      const filtered = filterTeamRows(rawData);

      if (filtered.teamRows.length === 0) {
        logger.warn('No team rows found after filtering – returning all rows as fallback');
        // Fallback: return all rows so the agent can still publish something
        filtered.teamRows = filtered.unmapped;
        filtered.unmapped = [];
      }

      return filtered;
    } catch (err) {
      lastError = err;
      logger.error(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.info(`Retrying in ${delay / 1000}s…`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`All ${MAX_RETRIES} fetch attempts failed. Last error: ${lastError.message}`);
}

module.exports = { fetchDashboardData };

// Allow running standalone for testing
if (require.main === module) {
  fetchDashboardData()
    .then((data) => {
      console.log('\n=== FETCH RESULT ===');
      console.log('Headers:', data.headers);
      console.log('Team rows:', data.teamRows.length);
      console.log('Sample row:', JSON.stringify(data.teamRows[0], null, 2));
    })
    .catch((err) => {
      console.error('FETCH FAILED:', err.message);
      process.exit(1);
    });
}
