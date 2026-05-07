'use strict';

/**
 * Analyzes filtered KAM performance data and produces a structured report
 * used by the Slack formatter.
 *
 * All column name lookups use fuzzy matching to be resilient to minor
 * header variations across dashboard versions.
 */

const logger = require('./logger');

// ─── Column resolver ─────────────────────────────────────────────────────────

const COLUMN_ALIASES = {
  kamName:       ['kam_name', 'kam', 'name', 'sales_executive', 'se_name', 'executive'],
  region:        ['region', 'zone', 'territory', 'area', 'city'],
  leads:         ['leads', 'lead', 'total_leads', 'leads_assigned'],
  appointments:  ['appointments', 'appointment', 'appts', 'apt'],
  inspections:   ['inspections', 'inspection', 'insp', 'total_inspections'],
  stockIns:      ['stock_in', 'stock_ins', 'stockin', 'stock', 'total_stock'],
  conversion:    ['conversion', 'conversion_pct', 'conversion_percent', 'conv_percent', 'conv_pct', 'conversion_rate'],
  mtdLeads:      ['mtd_leads', 'mtd_lead'],
  mtdAppts:      ['mtd_appointments', 'mtd_appt', 'mtd_apt'],
  mtdInsp:       ['mtd_inspections', 'mtd_insp'],
  mtdStock:      ['mtd_stock_in', 'mtd_stock', 'mtd_stockin'],
  mtdConversion: ['mtd_conversion', 'mtd_conv', 'mtd_conversion_pct'],
  tlName:        ['tl_name', 'tl', 'team_lead', 'manager'],
  tmEmail:       ['tm_email', 'email', 'manager_email'],
};

function resolve(row, field) {
  const aliases = COLUMN_ALIASES[field] || [field];
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') return row[alias];
  }
  return null;
}

function num(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 decimal
}

// ─── Core analysis ───────────────────────────────────────────────────────────

function analyzeData(filteredData) {
  const { teamRows, unmapped, fetchedAt, rawHeaders } = filteredData;

  if (!teamRows || teamRows.length === 0) {
    return { empty: true, fetchedAt };
  }

  // Build per-KAM stats
  const kams = teamRows.map((row) => {
    const name        = resolve(row, 'kamName') || 'Unknown KAM';
    const region      = resolve(row, 'region')  || 'N/A';
    const leads       = num(resolve(row, 'leads'));
    const appts       = num(resolve(row, 'appointments'));
    const inspections = num(resolve(row, 'inspections'));
    const stockIns    = num(resolve(row, 'stockIns'));
    const convRaw     = resolve(row, 'conversion');
    const conversion  = convRaw !== null ? num(convRaw) : pct(stockIns, leads);

    const mtdLeads    = num(resolve(row, 'mtdLeads'))    || leads;
    const mtdAppts    = num(resolve(row, 'mtdAppts'))    || appts;
    const mtdInsp     = num(resolve(row, 'mtdInsp'))     || inspections;
    const mtdStock    = num(resolve(row, 'mtdStock'))    || stockIns;
    const mtdConvRaw  = resolve(row, 'mtdConversion');
    const mtdConv     = mtdConvRaw !== null ? num(mtdConvRaw) : pct(mtdStock, mtdLeads);

    return {
      name,
      region,
      leads,
      appts,
      inspections,
      stockIns,
      conversion,
      mtdLeads,
      mtdAppts,
      mtdInsp,
      mtdStock,
      mtdConv,
      apptToInspConv: pct(inspections, appts),
      inspToStockConv: pct(stockIns, inspections),
    };
  });

  // ── Team aggregates (Daily) ──────────────────────────────────────────────
  const totalLeads       = kams.reduce((s, k) => s + k.leads, 0);
  const totalAppts       = kams.reduce((s, k) => s + k.appts, 0);
  const totalInsp        = kams.reduce((s, k) => s + k.inspections, 0);
  const totalStock       = kams.reduce((s, k) => s + k.stockIns, 0);
  const overallConv      = pct(totalStock, totalLeads);
  const apptToInspTeam   = pct(totalInsp, totalAppts);
  const inspToStockTeam  = pct(totalStock, totalInsp);

  // ── MTD aggregates ───────────────────────────────────────────────────────
  const mtdTotalLeads  = kams.reduce((s, k) => s + k.mtdLeads, 0);
  const mtdTotalAppts  = kams.reduce((s, k) => s + k.mtdAppts, 0);
  const mtdTotalInsp   = kams.reduce((s, k) => s + k.mtdInsp, 0);
  const mtdTotalStock  = kams.reduce((s, k) => s + k.mtdStock, 0);
  const mtdOverallConv = pct(mtdTotalStock, mtdTotalLeads);

  // ── MTD averages per KAM ─────────────────────────────────────────────────
  const n = kams.length || 1;
  const mtdAvgStock = mtdTotalStock / n;
  const mtdAvgConv  = mtdOverallConv;

  // ── Rankings ─────────────────────────────────────────────────────────────
  const byStock   = [...kams].sort((a, b) => b.stockIns - a.stockIns);
  const byMtdStock= [...kams].sort((a, b) => b.mtdStock - a.mtdStock);
  const top3      = byStock.slice(0, 3);
  const bottom3   = byStock.slice(-3).reverse();
  const topPerformer    = byStock[0];
  const lowestPerformer = byStock[byStock.length - 1];

  // ── Region breakdown ─────────────────────────────────────────────────────
  const regionMap = {};
  kams.forEach((k) => {
    if (!regionMap[k.region]) regionMap[k.region] = { leads: 0, inspections: 0, stockIns: 0 };
    regionMap[k.region].leads       += k.leads;
    regionMap[k.region].inspections += k.inspections;
    regionMap[k.region].stockIns    += k.stockIns;
  });
  const regions = Object.entries(regionMap)
    .map(([name, d]) => ({
      name,
      ...d,
      inspPct: totalInsp > 0 ? pct(d.inspections, totalInsp) : 0,
    }))
    .sort((a, b) => b.inspections - a.inspections);

  // ── Below MTD average ────────────────────────────────────────────────────
  const belowMtdAvg = kams.filter((k) => k.mtdStock < mtdAvgStock);

  // ── KAM above conversion target (20%) ───────────────────────────────────
  const highConvKams = kams.filter((k) => k.conversion >= 20);

  // ── Conversion gap alerts ────────────────────────────────────────────────
  const apptInspGap  = apptToInspTeam;  // store for trend comparison
  const inspStockGap = inspToStockTeam;

  // ── Contribution % ───────────────────────────────────────────────────────
  kams.forEach((k) => {
    k.stockContribPct = pct(k.stockIns, totalStock);
    k.insPct          = pct(k.inspections, totalInsp);
  });

  const report = {
    fetchedAt,
    date: new Date(fetchedAt),
    team: {
      totalKams: kams.length,
      leads: totalLeads,
      appts: totalAppts,
      inspections: totalInsp,
      stockIns: totalStock,
      overallConv,
      apptToInspConv: apptToInspTeam,
      inspToStockConv: inspToStockTeam,
    },
    mtd: {
      leads: mtdTotalLeads,
      appts: mtdTotalAppts,
      inspections: mtdTotalInsp,
      stockIns: mtdTotalStock,
      overallConv: mtdOverallConv,
      avgStockPerKam: Math.round(mtdAvgStock * 10) / 10,
      avgConv: mtdAvgConv,
    },
    topPerformer,
    lowestPerformer,
    top3,
    bottom3,
    leaderboard: byMtdStock,
    regions,
    kams,
    belowMtdAvg,
    highConvKams,
    unmappedCount: unmapped ? unmapped.length : 0,
    rawHeaders,
  };

  logger.info(
    `Analysis complete: ${kams.length} KAMs | Leads: ${totalLeads} | Stock: ${totalStock} | Conv: ${overallConv}%`
  );

  return report;
}

module.exports = { analyzeData };
