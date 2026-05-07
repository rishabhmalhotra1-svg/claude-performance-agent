'use strict';

/**
 * Formats the analysis report into a professional Slack message.
 * Produces a single mrkdwn-formatted string ready to post.
 */

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function bar(value, max, width = 10) {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

function trend(current, reference) {
  if (reference === 0) return current > 0 ? '↑' : '–';
  const delta = current - reference;
  if (delta > 0) return `↑ +${delta}`;
  if (delta < 0) return `↓ ${delta}`;
  return '→ 0';
}

// ─── Error message ───────────────────────────────────────────────────────────

function formatError(err, date) {
  const d = date ? formatDate(date) : formatDate(new Date());
  return [
    `⚠️ *Rishabh Malhotra Team – Performance Update | ${d}*`,
    '',
    '🔴 *Dashboard Fetch Failed*',
    `> Error: ${err.message}`,
    '',
    '• Automatic retry will be triggered.',
    '• Please verify dashboard availability.',
    '• Manual data pull may be required if issue persists.',
  ].join('\n');
}

// ─── Empty data message ──────────────────────────────────────────────────────

function formatEmpty(fetchedAt) {
  return [
    `📊 *Rishabh Malhotra Team – Daily Performance Update | ${formatDate(fetchedAt)}*`,
    '',
    '⚠️ No KAM records found for the team today.',
    'Dashboard was reachable but contained no mapped data for Rishabh Malhotra\'s team.',
    '',
    '_Please verify team mapping in the source dashboard._',
  ].join('\n');
}

// ─── Main report formatter ───────────────────────────────────────────────────

function formatReport(report) {
  const { date, team, mtd, topPerformer, lowestPerformer, top3, bottom3,
          leaderboard, regions, kams, belowMtdAvg, highConvKams, unmappedCount } = report;

  const dateStr = formatDate(date);
  const maxStock = leaderboard.length > 0 ? leaderboard[0].mtdStock : 1;

  const lines = [];

  // ── Header ───────────────────────────────────────────────────────────────
  lines.push(`📊 *Rishabh Malhotra Team – Daily Performance Update | ${dateStr}*`);
  lines.push('─'.repeat(56));

  // ── Top Performer ─────────────────────────────────────────────────────────
  if (topPerformer) {
    lines.push('');
    lines.push('🔥 *Top Performer of the Day*');
    lines.push(
      `> *${topPerformer.name}* (${topPerformer.region}) – ` +
      `${topPerformer.inspections} Insp | ${topPerformer.stockIns} Stock Ins | ` +
      `${topPerformer.conversion}% Conv`
    );
  }

  // ── Daily Team Summary ────────────────────────────────────────────────────
  lines.push('');
  lines.push('📈 *Daily Team Summary*');
  lines.push(`• Leads          : *${team.leads}*`);
  lines.push(`• Appointments   : *${team.appts}*`);
  lines.push(`• Inspections    : *${team.inspections}*`);
  lines.push(`• Stock Ins      : *${team.stockIns}*`);
  lines.push(`• Overall Conv   : *${team.overallConv}%*`);
  lines.push(`• Appt → Insp    : *${team.apptToInspConv}%*`);
  lines.push(`• Insp → Stock   : *${team.inspToStockConv}%*`);
  lines.push(`• Active KAMs    : *${team.totalKams}*`);

  // ── MTD Summary ──────────────────────────────────────────────────────────
  lines.push('');
  lines.push('📅 *MTD Summary (Month-to-Date)*');
  lines.push(`• MTD Leads      : *${mtd.leads}*`);
  lines.push(`• MTD Appts      : *${mtd.appts}*`);
  lines.push(`• MTD Inspections: *${mtd.inspections}*`);
  lines.push(`• MTD Stock Ins  : *${mtd.stockIns}*`);
  lines.push(`• MTD Conv       : *${mtd.overallConv}%*`);
  lines.push(`• Avg Stock/KAM  : *${mtd.avgStockPerKam}*`);

  // ── MTD Leaderboard ───────────────────────────────────────────────────────
  lines.push('');
  lines.push('🏆 *MTD Leaderboard – Stock Ins*');
  leaderboard.slice(0, 10).forEach((k, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const b = bar(k.mtdStock, maxStock);
    lines.push(`${medal} *${k.name}* – ${k.mtdStock} Stock | ${k.mtdConv}% Conv | ${b}`);
  });

  // ── Top 3 / Bottom 3 Today ────────────────────────────────────────────────
  lines.push('');
  lines.push('🌟 *Today\'s Top 3 Performers*');
  top3.forEach((k, i) => {
    lines.push(`  ${i + 1}. *${k.name}* – ${k.stockIns} Stock | ${k.inspections} Insp | ${k.conversion}% Conv`);
  });

  lines.push('');
  lines.push('📉 *Today\'s Bottom 3 – Need Attention*');
  bottom3.forEach((k, i) => {
    lines.push(`  ${i + 1}. *${k.name}* – ${k.stockIns} Stock | ${k.inspections} Insp | ${k.conversion}% Conv`);
  });

  // ── Region Performance ────────────────────────────────────────────────────
  if (regions.length > 0) {
    lines.push('');
    lines.push('🗺️ *Region-wise Contribution*');
    regions.forEach((r) => {
      lines.push(`• *${r.name}*: ${r.inspections} Insp (${r.inspPct}% of team) | ${r.stockIns} Stock`);
    });
  }

  // ── KAM-level breakdown ───────────────────────────────────────────────────
  lines.push('');
  lines.push('👥 *KAM-Level Performance (Today)*');
  lines.push('```');
  const colW = [22, 5, 5, 5, 5, 6];
  const header = [
    'KAM Name'.padEnd(colW[0]),
    'Leads'.padEnd(colW[1]),
    'Appt'.padEnd(colW[2]),
    'Insp'.padEnd(colW[3]),
    'Stk'.padEnd(colW[4]),
    'Conv%'.padEnd(colW[5]),
  ].join(' | ');
  lines.push(header);
  lines.push('-'.repeat(header.length));
  kams.forEach((k) => {
    const belowAvg = belowMtdAvg.includes(k) ? '*' : ' ';
    lines.push([
      `${belowAvg}${k.name}`.padEnd(colW[0]),
      String(k.leads).padEnd(colW[1]),
      String(k.appts).padEnd(colW[2]),
      String(k.inspections).padEnd(colW[3]),
      String(k.stockIns).padEnd(colW[4]),
      `${k.conversion}%`.padEnd(colW[5]),
    ].join(' | '));
  });
  lines.push('  * = Below MTD average');
  lines.push('```');

  // ── Attention Areas ───────────────────────────────────────────────────────
  lines.push('');
  lines.push('⚠️ *Attention Areas*');

  if (team.apptToInspConv < 50) {
    lines.push(`• Appt → Insp conversion at *${team.apptToInspConv}%* – below 50% threshold`);
  }
  if (team.inspToStockConv < 60) {
    lines.push(`• Insp → Stock conversion at *${team.inspToStockConv}%* – improvement needed`);
  }
  if (belowMtdAvg.length > 0) {
    lines.push(`• *${belowMtdAvg.length} KAM(s)* below MTD stock average (${mtd.avgStockPerKam}): ${belowMtdAvg.map((k) => k.name).join(', ')}`);
  }
  if (lowestPerformer && lowestPerformer.stockIns === 0) {
    lines.push(`• *${lowestPerformer.name}* recorded 0 stock-ins today – immediate follow-up required`);
  }
  if (unmappedCount > 0) {
    lines.push(`• *${unmappedCount} unmapped KAM(s)* detected – not included in team calculations`);
  }
  if (team.apptToInspConv >= 50 && team.inspToStockConv >= 60 && belowMtdAvg.length === 0) {
    lines.push('• No critical alerts today – team performing within thresholds ✅');
  }

  // ── Insights ─────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('💡 *Key Insights*');

  if (highConvKams.length > 0) {
    lines.push(`• *${highConvKams.length} KAM(s)* achieved ≥20% conversion today: ${highConvKams.map((k) => k.name).join(', ')}`);
  }
  if (regions.length > 0) {
    const topRegion = regions[0];
    lines.push(`• *${topRegion.name}* region contributed *${topRegion.inspPct}%* of today's total inspections`);
  }
  if (team.stockIns > 0 && mtd.stockIns > 0) {
    const dayAvg = Math.round((mtd.stockIns / new Date(date).getDate()) * 10) / 10;
    const momentum = team.stockIns >= dayAvg ? '📈 on track' : '📉 below daily run rate';
    lines.push(`• Daily stock-ins vs MTD run rate: *${team.stockIns}* vs *${dayAvg}* avg – ${momentum}`);
  }
  if (top3[0]) {
    lines.push(`• Top KAM *${top3[0].name}* contributed *${top3[0].stockContribPct}%* of today's total stock-ins`);
  }

  // ── Motivation ────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('─'.repeat(56));

  const motivations = [
    '🚀 Every lead is an opportunity – let\'s close the gap and finish the month strong!',
    '💪 Strong inspections today – now convert every single one into a stock-in!',
    '🎯 Consistency beats intensity – keep the momentum going tomorrow!',
    '🏁 MTD targets are within reach – one more push and we get there together!',
    '⚡ Champions are made in the last mile – let\'s make every appointment count!',
  ];
  const motivIdx = new Date(date).getDay() % motivations.length;
  lines.push(motivations[motivIdx]);
  lines.push('');
  lines.push(`_Report generated: ${new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST_`);

  return lines.join('\n');
}

module.exports = { formatReport, formatError, formatEmpty };
