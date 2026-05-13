'use strict';

/**
 * All Slack message templates for the team-rishabh-sunny-nikhil automation.
 *
 * User IDs (resolved from Slack):
 *   sunny.sharma  → U04Q2RM88GP
 *   sunny.12      → U09LZNDQ7KJ
 *   Nikhil.virmani→ U06LU7ZTEEM
 *
 * Channel:
 *   team-rishabh-sunny-nikhil → C0B3BV6UL03
 */

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1HPSoWeFua4EXYEFu1OI2COafIuMphL-t3APyFukNoLk/edit?gid=0#gid=0';

const USERS = {
  'sunny.sharma':   'U04Q2RM88GP',
  'sunny.12':       'U09LZNDQ7KJ',
  'nikhil.virmani': 'U06LU7ZTEEM',
};

function tag(userId) {
  return `<@${userId}>`;
}

function todayIST() {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

// ─── TASK 2: Commitment Message ───────────────────────────────────────────────

function commitmentMessage() {
  return `🔥 *Day Plan | Today's Commitment Update Required* | ${todayIST()}

${tag(USERS['sunny.sharma'])} ${tag(USERS['sunny.12'])} ${tag(USERS['nikhil.virmani'])}

Please fill in today's commitment numbers *KAM-wise* in the sheet below and share a screenshot here once done:
🔗 <${SHEET_URL}|Commitment & EOD Tracker Sheet>

⏰ *Please share your commitment before 11:30 AM.*
✅ Make sure numbers are accurate – no over-reporting or under-reporting.

${tag(USERS['nikhil.virmani'])} please share DSA commitment separately in the same sheet and share screenshot after updating.`;
}

// ─── TASK 3: EOD Message ──────────────────────────────────────────────────────

function eodMessage() {
  return `📌 *Day Plan | EOD Update Required* | ${todayIST()}

${tag(USERS['sunny.sharma'])} ${tag(USERS['sunny.12'])} ${tag(USERS['nikhil.virmani'])}

Please fill in today's EOD numbers *KAM-wise* in the sheet below and share a screenshot here once done:
🔗 <${SHEET_URL}|Commitment & EOD Tracker Sheet>

⏰ *Please share your EOD before 7:30 PM.*
✅ Make sure numbers are accurate – no over-reporting or under-reporting.

${tag(USERS['nikhil.virmani'])} please share DSA EOD separately in the same sheet and share screenshot after updating.`;
}

// ─── TASK 4: Reminder Messages ────────────────────────────────────────────────

function reminderMessage(pendingUserIds, type) {
  const typeLabel = type === 'commitment' ? 'Commitment' : 'EOD';
  const tags = pendingUserIds.map(tag).join(' ');
  return `⚠️ *Reminder: ${typeLabel} Update Pending*

${tags}

Please update the Google Sheet and share screenshot for pending *${typeLabel}* update ASAP.
🔗 <${SHEET_URL}|Commitment & EOD Tracker Sheet>`;
}

// ─── TASK 1: KAM Performance Table ───────────────────────────────────────────

function kamPerformanceMessage(kamData) {
  if (!kamData || kamData.length === 0) {
    return `📊 *KAM PERFORMANCE UPDATE* | ${todayIST()}\n\n⚠️ CSV data not received or invalid for today's KAM report.`;
  }

  const header = [
    '📊 *KAM PERFORMANCE UPDATE* | ' + todayIST(),
    '',
    '```',
    padRow([
      'KAM', 'Yday Calls', 'Yday Visits', 'MTD Calls', 'MTD Visits',
      'Avg Calls', 'Avg Visits', 'Leads', 'Appts', 'Insps',
      'File', 'DCF Form', 'DCF/DSA Onbrd', 'Disbursal', 'PR', 'SI',
    ]),
    '─'.repeat(140),
  ];

  const rows = kamData.map((k) =>
    padRow([
      truncate(k.kam || '–', 22),
      k.ydayCalls      || '0',
      k.ydayVisits     || '0',
      k.mtdCalls       || '0',
      k.mtdVisits      || '0',
      k.avgCalls       || '0',
      k.avgVisits      || '0',
      k.leads          || '0',
      k.appts          || '0',
      k.insps          || '0',
      k.file           || '0',
      k.dcfForm        || '0',
      k.dcfOnboarding  || '0',
      k.disbursal      || '0',
      k.pr             || '0',
      k.si             || '0',
    ])
  );

  return [...header, ...rows, '```'].join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COL_WIDTHS = [23, 11, 12, 10, 11, 10, 11, 6, 6, 6, 6, 9, 14, 10, 4, 4];

function padRow(cells) {
  return cells.map((c, i) => String(c).padEnd(COL_WIDTHS[i] || 8)).join(' ');
}

function truncate(s, len) {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// ─── No-CSV Notice ────────────────────────────────────────────────────────────

function noCSVMessage() {
  return `📊 *KAM PERFORMANCE UPDATE* | ${todayIST()}\n\n⚠️ CSV data not received or invalid for today's KAM report.`;
}

module.exports = {
  USERS,
  CHANNEL_ID: 'C0B3BV6UL03',
  commitmentMessage,
  eodMessage,
  reminderMessage,
  kamPerformanceMessage,
  noCSVMessage,
};
