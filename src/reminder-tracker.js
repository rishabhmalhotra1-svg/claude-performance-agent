'use strict';

/**
 * Tracks daily reminder state for Commitment and EOD tasks.
 * State is persisted to logs/reminder-state.json so it survives restarts.
 *
 * For each type ('commitment' | 'eod') it records:
 *   - sent: boolean (initial message sent today)
 *   - reminders: number (0, 1, or 2 – max 2)
 *   - pendingUsers: string[] (user IDs still pending)
 *   - date: string (YYYY-MM-DD, resets daily)
 */

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');
const { USERS } = require('./slack-messages');

const STATE_FILE = path.join(__dirname, '..', 'logs', 'reminder-state.json');

const ALL_USERS = Object.values(USERS); // [U04Q2RM88GP, U09LZNDQ7KJ, U06LU7ZTEEM]

function todayKey() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function emptyState(date) {
  return {
    date,
    commitment: { sent: false, reminders: 0, pendingUsers: [...ALL_USERS], triggerTs: null },
    eod:        { sent: false, reminders: 0, pendingUsers: [...ALL_USERS], triggerTs: null },
  };
}

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (raw.date === todayKey()) return raw;
    }
  } catch { /* ignore */ }
  return emptyState(todayKey());
}

function save(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error(`Failed to save reminder state: ${err.message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function markSent(type, triggerTs) {
  const state = load();
  state[type].sent = true;
  state[type].pendingUsers = [...ALL_USERS]; // reset pending on fresh send
  state[type].reminders = 0;
  state[type].triggerTs = triggerTs || null;
  save(state);
  logger.info(`Reminder state: ${type} marked as sent (ts: ${triggerTs})`);
}

function getTriggerTs(type) {
  return load()[type].triggerTs;
}

function markAcknowledged(type, userId) {
  const state = load();
  state[type].pendingUsers = state[type].pendingUsers.filter((id) => id !== userId);
  save(state);
  logger.info(`Reminder state: ${userId} acknowledged ${type}`);
}

/**
 * Returns pending user IDs for a reminder if eligible, or null if not.
 * Increments reminder count.
 */
function getNextReminder(type) {
  const state = load();
  const t = state[type];

  if (!t.sent) return null;
  if (t.reminders >= 2) {
    logger.info(`Reminder state: max reminders (2) already sent for ${type}`);
    return null;
  }
  if (t.pendingUsers.length === 0) {
    logger.info(`Reminder state: all users acknowledged ${type} – no reminder needed`);
    return null;
  }

  t.reminders += 1;
  save(state);
  logger.info(`Reminder state: sending reminder ${t.reminders}/2 for ${type} to ${t.pendingUsers.join(', ')}`);
  return [...t.pendingUsers];
}

function getState(type) {
  return load()[type];
}

function isSent(type) {
  return load()[type].sent;
}

module.exports = { markSent, markAcknowledged, getNextReminder, getState, isSent, getTriggerTs };
