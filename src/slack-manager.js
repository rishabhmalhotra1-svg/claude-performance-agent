'use strict';
const axios = require('axios');
const logger = require('./logger');

const CHANNEL_ID      = process.env.SLACK_CHANNEL_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function sendMessage(text) {
  await axios.post('https://slack.com/api/chat.postMessage', {
    channel: CHANNEL_ID,
    text,
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
}

async function getRecentMessages(limit = 40) {
  const res = await axios.get('https://slack.com/api/conversations.history', {
    params: { channel: CHANNEL_ID, limit },
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
  return res.data.messages || [];
}

function todayIST() {
  return new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
}

function hasSubmittedToday(messages, userId) {
  const todayStr = todayIST();
  return messages.some(m => {
    const msgDate = new Date(m.ts * 1000).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
    return m.user === userId && msgDate === todayStr &&
      (m.files?.length > 0 || (m.text && m.text.toLowerCase().includes('commitment')));
  });
}

const TMS = [
  { id: 'U04Q2RM88GP', name: 'sunny.sharma' },
  { id: 'U09LZNDQ7KJ', name: 'sunny.12' },
  { id: 'U06LU7ZTEEM', name: 'nikhil.virmani' },
];

const SHEET = 'https://docs.google.com/spreadsheets/d/1HPSoWeFua4EXYEFu1OI2COafIuMphL-t3APyFukNoLk/edit?gid=0#gid=0';

async function runNow(task) {
  logger.info(`[SlackManager] Running task: ${task}`);
  const messages = await getRecentMessages(40);
  const pending = TMS.filter(tm => !hasSubmittedToday(messages, tm.id));
  const tags = pending.map(tm => `<@${tm.id}>`).join(' ');
  const date = todayIST();

  if (task === 'day-plan') {
    await sendMessage(
`🔥 *Day Plan | Today's Commitment Update Required | ${date}*

<@U04Q2RM88GP> <@U09LZNDQ7KJ> <@U06LU7ZTEEM>

Please fill in today's commitment numbers KAM-wise in the sheet below and share a screenshot here once done:
🔗 _Commitment & EOD Tracker Sheet_
${SHEET}

⏰ Please share your commitment before _11:30 AM_.
✅ Make sure numbers are accurate – no over-reporting or under-reporting.

<@U06LU7ZTEEM> please share _DSA commitment separately_ in the same sheet and share screenshot after updating.`
    );

  } else if (task === 'reminder-1' || task === 'reminder-2') {
    if (pending.length === 0) return logger.info('All submitted — skipping reminder');
    const num = task === 'reminder-1' ? '1' : '2';
    await sendMessage(
`⚠️ *Reminder ${num}: Commitment Update Pending*

${tags}

Please update the Google Sheet and share screenshot for pending *Commitment* update ASAP.
🔗 ${SHEET}`
    );

  } else if (task === 'escalation') {
    if (pending.length === 0) return logger.info('All submitted — skipping escalation');
    await sendMessage(
`🚨 *Escalation | Commitment Update Still Pending*

${tags}

Commitment update is still pending despite two reminders. Please update immediately and maintain timeline discipline. This will be noted in the daily summary.`
    );

  } else if (task === 'eod') {
    await sendMessage(
`📊 *EOD Update | Achievement Numbers Required | ${date}*

<@U04Q2RM88GP> <@U09LZNDQ7KJ> <@U06LU7ZTEEM>

Please share today's EOD achievement numbers KAM-wise. Update the sheet and share screenshot.
🔗 ${SHEET}

⏰ EOD update due by *7:30 PM*.`
    );

  } else if (task === 'eod-reminder-1' || task === 'eod-reminder-2') {
    if (pending.length === 0) return logger.info('All submitted — skipping EOD reminder');
    const num = task === 'eod-reminder-1' ? '1' : '2';
    await sendMessage(
`⚠️ *EOD Reminder ${num}: Achievement Update Pending*

${tags}

EOD numbers still not shared. Update the sheet and post screenshot now.
🔗 ${SHEET}`
    );

  } else if (task === 'eod-escalation') {
    if (pending.length === 0) return logger.info('All submitted — skipping EOD escalation');
    await sendMessage(
`🚨 *Escalation | EOD Update Still Pending*

${tags}

EOD achievement numbers are still missing after two reminders. Update immediately. This will be flagged in the daily summary.`
    );
  } else {
    logger.warn(`[SlackManager] Unknown task: "${task}" — skipping`);
  }
}

function startSlackManager() {
  logger.info('[SlackManager] Slack manager started');
}

module.exports = { startSlackManager, runNow };
