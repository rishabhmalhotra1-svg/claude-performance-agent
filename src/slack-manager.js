'use strict';

/**
 * Slack Performance Automation Manager
 * Channel: #team-rishabh-sunny-nikhil (C0B3BV6UL03)
 *
 * Schedule (IST):
 *   11:30 AM  → Task 1 (KAM Performance, CSV-based) + Task 2 (Commitment)
 *   12:00 PM  → Reminder 1 for Commitment (if pending)
 *   12:30 PM  → Reminder 2 for Commitment (if pending)
 *    7:30 PM  → Task 3 (EOD)
 *    8:00 PM  → Reminder 1 for EOD (if pending)
 *    8:30 PM  → Reminder 2 for EOD (if pending)
 */

require('dotenv').config();

const axios   = require('axios');
const cron    = require('node-cron');
const logger  = require('./logger');
const { readCSVFiles, archiveCSVFiles } = require('./csv-parser');
const {
  CHANNEL_ID,
  RISHABH_ID,
  commitmentMessage,
  eodMessage,
  reminderMessage,
  kamPerformanceMessage,
  eodInsightsMessage,
  noCSVMessage,
} = require('./slack-messages');
const tracker = require('./reminder-tracker');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const TIMEZONE = 'Asia/Kolkata';

// ─── Slack post helper ────────────────────────────────────────────────────────

async function post(text, threadTs, channelOverride) {
  if (!SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN not set');

  const payload = {
    channel: channelOverride || CHANNEL_ID,
    text,
    mrkdwn: true,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };

  const resp = await axios.post('https://slack.com/api/chat.postMessage', payload, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    timeout: 15000,
  });

  if (!resp.data.ok) throw new Error(`Slack API error: ${resp.data.error}`);
  logger.info(`Slack post OK (ts: ${resp.data.ts})`);
  return resp.data.ts;
}

// ─── Task 1: KAM Performance ──────────────────────────────────────────────────

async function runKAMPerformance() {
  logger.info('[Task 1] KAM Performance – checking for CSV files…');
  try {
    const kamData = readCSVFiles();
    if (!kamData) {
      logger.info('[Task 1] No CSV files – skipping KAM performance report');
      return; // Do NOT send anything if no CSV
    }
    const msg = kamPerformanceMessage(kamData);
    await post(msg);
    archiveCSVFiles();
    logger.info('[Task 1] KAM Performance posted and CSVs archived');
  } catch (err) {
    logger.error(`[Task 1] Error: ${err.message}`);
    await post(noCSVMessage()).catch(() => {});
  }
}

// ─── Task 2: Commitment Message ───────────────────────────────────────────────

async function runCommitment() {
  logger.info('[Task 2] Sending Commitment message…');
  try {
    await post(commitmentMessage());
    tracker.markSent('commitment');
    logger.info('[Task 2] Commitment message sent');
  } catch (err) {
    logger.error(`[Task 2] Error: ${err.message}`);
  }
}

// ─── Task 3: EOD Message ──────────────────────────────────────────────────────

async function runEOD() {
  logger.info('[Task 3] Sending EOD message…');
  try {
    await post(eodMessage());
    tracker.markSent('eod');
    logger.info('[Task 3] EOD message sent');
  } catch (err) {
    logger.error(`[Task 3] Error: ${err.message}`);
  }
}

// ─── EOD Insights (9:00 PM IST) ──────────────────────────────────────────────

async function runEODInsights() {
  logger.info('[Insights] Generating EOD insights…');
  try {
    const csvData = readCSVFiles();           // looks for EOD CSV in data/
    const msg = eodInsightsMessage(csvData);
    // Post insights to channel + DM Rishabh
    await post(msg);
    await post(msg, null, RISHABH_ID);        // DM to Rishabh
    if (csvData) archiveCSVFiles();
    logger.info('[Insights] EOD insights posted');
  } catch (err) {
    logger.error(`[Insights] Error: ${err.message}`);
  }
}

// ─── Task 4: Reminders ────────────────────────────────────────────────────────

async function runReminder(type) {
  const pendingUsers = tracker.getNextReminder(type);
  if (!pendingUsers) {
    logger.info(`[Task 4] No reminder needed for ${type}`);
    return;
  }
  logger.info(`[Task 4] Sending ${type} reminder to ${pendingUsers.length} user(s)…`);
  try {
    await post(reminderMessage(pendingUsers, type));
    logger.info(`[Task 4] ${type} reminder sent to: ${pendingUsers.join(', ')}`);
  } catch (err) {
    logger.error(`[Task 4] Reminder error: ${err.message}`);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function startSlackManager() {
  logger.info('=== Slack Automation Manager starting ===');
  logger.info(`Channel: ${CHANNEL_ID}`);
  logger.info('Schedule (IST): 11:30 AM commitment+KAM | 12:00/12:30 reminders | 7:30 PM EOD | 8:00/8:30 reminders');

  // 11:30 AM IST – KAM Performance + Commitment
  cron.schedule('30 11 * * *', async () => {
    logger.info('--- 11:30 AM trigger ---');
    await runKAMPerformance();
    await runCommitment();
  }, { timezone: TIMEZONE });

  // 12:00 PM IST – Commitment Reminder 1
  cron.schedule('0 12 * * *', async () => {
    logger.info('--- 12:00 PM trigger (Commitment Reminder 1) ---');
    await runReminder('commitment');
  }, { timezone: TIMEZONE });

  // 12:30 PM IST – Commitment Reminder 2
  cron.schedule('30 12 * * *', async () => {
    logger.info('--- 12:30 PM trigger (Commitment Reminder 2) ---');
    await runReminder('commitment');
  }, { timezone: TIMEZONE });

  // 7:30 PM IST – EOD
  cron.schedule('30 19 * * *', async () => {
    logger.info('--- 7:30 PM trigger ---');
    await runEOD();
  }, { timezone: TIMEZONE });

  // 8:00 PM IST – EOD Reminder 1
  cron.schedule('0 20 * * *', async () => {
    logger.info('--- 8:00 PM trigger (EOD Reminder 1) ---');
    await runReminder('eod');
  }, { timezone: TIMEZONE });

  // 8:30 PM IST – EOD Reminder 2
  cron.schedule('30 20 * * *', async () => {
    logger.info('--- 8:30 PM trigger (EOD Reminder 2) ---');
    await runReminder('eod');
  }, { timezone: TIMEZONE });

  // 9:00 PM IST – EOD Insights for Rishabh
  cron.schedule('0 21 * * *', async () => {
    logger.info('--- 9:00 PM trigger (EOD Insights) ---');
    await runEODInsights();
  }, { timezone: TIMEZONE });

  logger.info('=== Slack Automation Manager running ===');
}

// ─── Manual trigger support ───────────────────────────────────────────────────

async function runNow(task) {
  switch (task) {
    case 'commitment':          return runCommitment();
    case 'eod':                 return runEOD();
    case 'kam':                 return runKAMPerformance();
    case 'reminder-commitment': return runReminder('commitment');
    case 'reminder-eod':        return runReminder('eod');
    case 'insights':            return runEODInsights();
    default:
      logger.info('Running all tasks in sequence (test mode)…');
      await runKAMPerformance();
      await runCommitment();
      await runEOD();
  }
}

module.exports = { startSlackManager, runNow };
