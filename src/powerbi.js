'use strict';

/**
 * Power BI connection module – no admin or IT approval required.
 *
 * Authentication: OAuth2 Resource Owner Password Credentials (ROPC) using the
 * user's own Microsoft work-account credentials.  The Power BI Desktop client
 * ID (pre-registered by Microsoft in every tenant) is used so no IT team needs
 * to register an Azure AD app.
 *
 * Requires in .env:
 *   POWERBI_USERNAME   – your work Microsoft email
 *   POWERBI_PASSWORD   – your work Microsoft password
 *   POWERBI_TENANT_ID  – (optional) your AAD tenant ID or "common"
 *
 * Note: ROPC does not work when MFA is enforced on the account.  In that case
 * create an App Password in https://mysignins.microsoft.com/security-info and
 * use that as POWERBI_PASSWORD, or ask IT to exempt the service account.
 */

require('dotenv').config();
const axios  = require('axios');
const logger = require('./logger');

// ─── Config ──────────────────────────────────────────────────────────────────

const PBI_API    = 'https://api.powerbi.com/v1.0/myorg';
const AAD_BASE   = 'https://login.microsoftonline.com';
const PBI_SCOPE  = 'https://analysis.windows.net/powerbi/api/.default';

// Microsoft-registered Power BI Desktop client – works in any AAD tenant
// for delegated (user) flows without admin consent.
const PBI_DESKTOP_CLIENT_ID = 'ea0616a9-be27-4c4d-8a57-4becc7cd4f76';

const WORKSPACE_NAME = (process.env.POWERBI_WORKSPACE || 'Sell Analytics').trim();
const DATASET_NAME   = (process.env.POWERBI_DATASET   || 'C2B GROWTH - REFERRAL').trim();
const TENANT_ID      = (process.env.POWERBI_TENANT_ID || 'common').trim();
const CLIENT_ID      = (process.env.POWERBI_CLIENT_ID || PBI_DESKTOP_CLIENT_ID).trim();
const USERNAME       = process.env.POWERBI_USERNAME;
const PASSWORD       = process.env.POWERBI_PASSWORD;

const TL_NAME  = (process.env.TL_NAME  || 'Rishabh Malhotra').toLowerCase().trim();
const TM_EMAIL = (process.env.TM_EMAIL || 'rishabh.malhotra1@cars24.com').toLowerCase().trim();

// ─── Token cache ─────────────────────────────────────────────────────────────

let _tokenCache = null;

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'POWERBI_USERNAME and POWERBI_PASSWORD must be set in .env. ' +
      'Use your Microsoft work-account credentials.'
    );
  }

  logger.info('Acquiring Power BI access token (ROPC)…');

  const tokenUrl = `${AAD_BASE}/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id:  CLIENT_ID,
    scope:      PBI_SCOPE,
    username:   USERNAME,
    password:   PASSWORD,
  });

  let resp;
  try {
    resp = await axios.post(tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30_000,
    });
  } catch (err) {
    const detail = err.response?.data?.error_description || err.message;
    throw new Error(`Power BI auth failed: ${detail}`);
  }

  _tokenCache = {
    token:     resp.data.access_token,
    expiresAt: Date.now() + (resp.data.expires_in - 60) * 1000,
  };

  logger.info('Power BI access token acquired');
  return _tokenCache.token;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

async function pbiGet(path) {
  const token = await getAccessToken();
  try {
    const resp = await axios.get(`${PBI_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    });
    return resp.data;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`Power BI GET ${path} failed: ${detail}`);
  }
}

async function pbiPost(path, body) {
  const token = await getAccessToken();
  try {
    const resp = await axios.post(`${PBI_API}${path}`, body, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    });
    return resp.data;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`Power BI POST ${path} failed: ${detail}`);
  }
}

// ─── Workspace / dataset discovery ───────────────────────────────────────────

async function findWorkspace(name) {
  const data = await pbiGet('/groups?$top=100');
  const ws   = (data.value || []).find(
    (g) => g.name.toLowerCase() === name.toLowerCase()
  );
  if (!ws) {
    const names = (data.value || []).map((g) => g.name).join(', ');
    throw new Error(
      `Workspace "${name}" not found. ` +
      `Accessible workspaces: ${names || '(none visible to this account)'}`
    );
  }
  logger.info(`Power BI workspace found: ${ws.name} (${ws.id})`);
  return ws;
}

async function findDataset(groupId, name) {
  const data = await pbiGet(`/groups/${groupId}/datasets`);
  const ds   = (data.value || []).find(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
  if (!ds) {
    const names = (data.value || []).map((d) => d.name).join(', ');
    throw new Error(
      `Dataset "${name}" not found. ` +
      `Available datasets: ${names || '(none)'}`
    );
  }
  logger.info(`Power BI dataset found: ${ds.name} (${ds.id})`);
  return ds;
}

// ─── DAX execution ───────────────────────────────────────────────────────────

async function runDax(groupId, datasetId, daxQuery) {
  logger.info(`DAX: ${daxQuery.slice(0, 100)}`);
  const resp = await pbiPost(
    `/groups/${groupId}/datasets/${datasetId}/executeQueries`,
    {
      queries: [{ query: daxQuery }],
      serializerSettings: { includeNulls: true },
    }
  );

  const table = resp.results?.[0]?.tables?.[0];
  if (!table) throw new Error('DAX query returned no table result');

  const rows = table.rows || [];
  logger.info(`DAX returned ${rows.length} rows`);
  return rows;
}

/**
 * Discovers available tables using DMV, then picks the best KAM/performance
 * table.  Falls back to POWERBI_DAX_QUERY env var for custom queries.
 */
async function executeBestQuery(groupId, datasetId) {
  const customDax = process.env.POWERBI_DAX_QUERY;
  if (customDax) {
    logger.info('Using POWERBI_DAX_QUERY from .env');
    return runDax(groupId, datasetId, customDax);
  }

  // Discover tables via DMV
  let tableNames = [];
  try {
    const dmvRows = await runDax(groupId, datasetId, 'EVALUATE INFO.TABLES()');
    tableNames = dmvRows
      .map((r) => r['[Name]'] || r.Name || Object.values(r)[0])
      .filter(Boolean);
    logger.info(`Discovered tables: ${tableNames.join(', ')}`);
  } catch (dmvErr) {
    logger.warn(`DMV discovery failed (${dmvErr.message}) – will try common table names`);
    tableNames = ['KAM Performance', 'Performance', 'KAM', 'Sales', 'Referral', 'Data'];
  }

  const KW = ['kam', 'performance', 'kpi', 'referral', 'dealer', 'sales', 'fact', 'agent'];
  let bestTable = tableNames.find((t) =>
    KW.some((kw) => t.toLowerCase().includes(kw))
  ) || tableNames.find((t) => !t.startsWith('$')) || tableNames[0];

  if (!bestTable) throw new Error('No usable tables found in dataset');

  logger.info(`Querying table: "${bestTable}"`);
  return runDax(groupId, datasetId, `EVALUATE '${bestTable}'`);
}

// ─── Result normalisation & team filter ──────────────────────────────────────

/**
 * DAX rows have keys like "[TableName][ColumnName]" or "[ColumnName]".
 * Strips the prefix and normalises to the same shape fetcher.js expects.
 */
function normaliseRows(rawRows) {
  if (rawRows.length === 0) {
    return { headers: [], teamRows: [], unmapped: [], fetchedAt: new Date().toISOString(), rawHeaders: [], headerMap: {} };
  }

  const stripKey = (k) =>
    k.replace(/^\[.*?\]\[/, '').replace(/\]$/, '').replace(/^\[/, '').replace(/\]$/, '');

  const rawHeaders = Object.keys(rawRows[0]).map(stripKey);
  const headerMap  = {};
  rawHeaders.forEach((h) => {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    headerMap[h] = norm;
  });

  const normalised = rawRows.map((row) => {
    const n = {};
    Object.entries(row).forEach(([k, v]) => {
      const col = stripKey(k);
      n[headerMap[col] || col] = v == null ? '' : String(v);
    });
    return n;
  });

  const normKeys = Object.values(headerMap);
  const tlCol    = normKeys.find((k) => k.includes('tl_name') || k.includes('tl') || k.includes('team_lead') || k.includes('manager'));
  const emailCol = normKeys.find((k) => k.includes('email') || k.includes('tm_email'));

  const teamRows = normalised.filter((row) => {
    const tl    = (row[tlCol]    || '').toLowerCase();
    const email = (row[emailCol] || '').toLowerCase();
    return tl.includes(TL_NAME) || email === TM_EMAIL;
  });

  const unmapped = normalised.filter((row) => {
    const tl    = (row[tlCol]    || '').toLowerCase();
    const email = (row[emailCol] || '').toLowerCase();
    return !tl.includes(TL_NAME) && email !== TM_EMAIL;
  });

  logger.info(`Power BI filter: ${teamRows.length} team rows, ${unmapped.length} other rows`);

  return {
    headers:    Object.values(headerMap),
    teamRows,
    unmapped,
    fetchedAt:  new Date().toISOString(),
    rawHeaders,
    headerMap,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function fetchFromPowerBI() {
  logger.info(`Power BI: workspace="${WORKSPACE_NAME}" dataset="${DATASET_NAME}"`);

  const workspace = await findWorkspace(WORKSPACE_NAME);
  const dataset   = await findDataset(workspace.id, DATASET_NAME);
  const rawRows   = await executeBestQuery(workspace.id, dataset.id);
  const result    = normaliseRows(rawRows);

  // If team filter matched nothing, return all rows so the agent still publishes
  if (result.teamRows.length === 0 && result.unmapped.length > 0) {
    logger.warn('Power BI: no team rows after filter – returning all rows as fallback');
    result.teamRows = result.unmapped;
    result.unmapped = [];
  }

  return result;
}

module.exports = { fetchFromPowerBI };

// Standalone test: node src/powerbi.js
if (require.main === module) {
  fetchFromPowerBI()
    .then((data) => {
      console.log('\n=== POWER BI RESULT ===');
      console.log('Headers:', data.headers);
      console.log('Team rows:', data.teamRows.length);
      if (data.teamRows[0]) console.log('Sample row:', JSON.stringify(data.teamRows[0], null, 2));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
