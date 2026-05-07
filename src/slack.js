'use strict';

/**
 * Publishes formatted messages to Slack using the Bot Token + Web API.
 * Supports both a single large text post and sectioned block posts.
 */

require('dotenv').config();
const axios = require('axios');
const logger = require('./logger');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const SLACK_API_BASE = 'https://slack.com/api';

function slackHeaders() {
  if (!SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is not set in environment');
  return {
    Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

/**
 * Posts a mrkdwn message to the configured Slack channel.
 * Slack limits messages to 4000 chars; longer texts are split into threads.
 */
async function postMessage(text, options = {}) {
  const channelId = options.channel || SLACK_CHANNEL_ID;
  if (!channelId) throw new Error('SLACK_CHANNEL_ID is not set in environment');

  const MAX_LEN = 3900;

  // Split into chunks if needed
  const chunks = [];
  if (text.length <= MAX_LEN) {
    chunks.push(text);
  } else {
    // Split on double-newlines to keep sections together
    const sections = text.split('\n\n');
    let current = '';
    for (const section of sections) {
      if ((current + '\n\n' + section).length > MAX_LEN && current.length > 0) {
        chunks.push(current.trim());
        current = section;
      } else {
        current = current ? current + '\n\n' + section : section;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  let threadTs = null;

  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      channel: channelId,
      text: chunks[i],
      mrkdwn: true,
      ...(threadTs && i > 0 ? { thread_ts: threadTs } : {}),
    };

    logger.info(`Posting Slack message chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

    const response = await axios.post(`${SLACK_API_BASE}/chat.postMessage`, payload, {
      headers: slackHeaders(),
      timeout: 15000,
    });

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    // Capture thread_ts from first message so subsequent chunks go into thread
    if (i === 0 && chunks.length > 1) {
      threadTs = response.data.ts;
      logger.info(`Multi-chunk message – continuation will be posted in thread ${threadTs}`);
    }

    logger.info(`Slack chunk ${i + 1} posted successfully`);
  }

  logger.info('Slack message published successfully');
  return true;
}

/**
 * Posts an error notification to Slack.
 */
async function postError(errorMsg, date) {
  const { formatError } = require('./formatter');
  const text = formatError({ message: errorMsg }, date);
  try {
    await postMessage(text);
  } catch (slackErr) {
    logger.error(`Failed to post error notification to Slack: ${slackErr.message}`);
  }
}

/**
 * Test mode: prints what would be sent without actually calling Slack.
 */
async function testPost(text) {
  console.log('\n=== SLACK MESSAGE PREVIEW ===\n');
  console.log(text);
  console.log('\n=== END PREVIEW ===\n');
  console.log(`Message length: ${text.length} chars`);
}

module.exports = { postMessage, postError, testPost };

// Standalone test
if (require.main === module) {
  const { formatReport } = require('./formatter');
  const sampleReport = {
    fetchedAt: new Date().toISOString(),
    date: new Date(),
    team: { totalKams: 5, leads: 120, appts: 85, inspections: 62, stockIns: 30, overallConv: 25.0, apptToInspConv: 72.9, inspToStockConv: 48.4 },
    mtd: { leads: 900, appts: 640, inspections: 470, stockIns: 210, overallConv: 23.3, avgStockPerKam: 42.0, avgConv: 23.3 },
    topPerformer: { name: 'Amit Sharma', region: 'North', inspections: 18, stockIns: 9, conversion: 32.1 },
    lowestPerformer: { name: 'Ravi Kumar', region: 'West', inspections: 4, stockIns: 1, conversion: 8.3 },
    top3: [
      { name: 'Amit Sharma', region: 'North', stockIns: 9, inspections: 18, conversion: 32.1, stockContribPct: 30.0 },
      { name: 'Priya Singh', region: 'South', stockIns: 7, inspections: 14, conversion: 28.0, stockContribPct: 23.3 },
      { name: 'Karan Mehta', region: 'East',  stockIns: 6, inspections: 12, conversion: 25.0, stockContribPct: 20.0 },
    ],
    bottom3: [
      { name: 'Ravi Kumar',   region: 'West',  stockIns: 1, inspections: 4,  conversion: 8.3 },
      { name: 'Deepa Nair',   region: 'South', stockIns: 3, inspections: 7,  conversion: 15.0 },
      { name: 'Suresh Patel', region: 'North', stockIns: 4, inspections: 9,  conversion: 16.7 },
    ],
    leaderboard: [
      { name: 'Amit Sharma',  mtdStock: 72, mtdConv: 31.5, stockContribPct: 34.3 },
      { name: 'Priya Singh',  mtdStock: 61, mtdConv: 27.2, stockContribPct: 29.0 },
      { name: 'Karan Mehta',  mtdStock: 43, mtdConv: 24.0, stockContribPct: 20.5 },
      { name: 'Suresh Patel', mtdStock: 22, mtdConv: 17.0, stockContribPct: 10.5 },
      { name: 'Ravi Kumar',   mtdStock: 12, mtdConv: 9.8,  stockContribPct: 5.7  },
    ],
    regions: [
      { name: 'North', inspections: 27, stockIns: 13, inspPct: 43.5 },
      { name: 'South', inspections: 21, stockIns: 10, inspPct: 33.9 },
      { name: 'East',  inspections: 14, stockIns: 7,  inspPct: 22.6 },
    ],
    kams: [
      { name: 'Amit Sharma',  region: 'North', leads: 30, appts: 22, inspections: 18, stockIns: 9,  conversion: 32.1, stockContribPct: 30.0, insPct: 29.0 },
      { name: 'Priya Singh',  region: 'South', leads: 25, appts: 18, inspections: 14, stockIns: 7,  conversion: 28.0, stockContribPct: 23.3, insPct: 22.6 },
      { name: 'Karan Mehta',  region: 'East',  leads: 24, appts: 17, inspections: 12, stockIns: 6,  conversion: 25.0, stockContribPct: 20.0, insPct: 19.4 },
      { name: 'Suresh Patel', region: 'North', leads: 22, appts: 15, inspections: 10, stockIns: 7,  conversion: 31.8, stockContribPct: 23.3, insPct: 16.1 },
      { name: 'Ravi Kumar',   region: 'West',  leads: 19, appts: 13, inspections: 8,  stockIns: 1,  conversion: 5.3,  stockContribPct: 3.3,  insPct: 12.9 },
    ],
    belowMtdAvg: [
      { name: 'Ravi Kumar', region: 'West', stockIns: 1, mtdStock: 12 },
    ],
    highConvKams: [
      { name: 'Amit Sharma', conversion: 32.1 },
      { name: 'Suresh Patel', conversion: 31.8 },
      { name: 'Priya Singh', conversion: 28.0 },
    ],
    unmappedCount: 0,
    rawHeaders: [],
  };

  const text = formatReport(sampleReport);

  const args = process.argv.slice(2);
  if (args.includes('--post') && SLACK_BOT_TOKEN && SLACK_CHANNEL_ID) {
    postMessage(text)
      .then(() => console.log('Posted to Slack!'))
      .catch((e) => console.error('Slack error:', e.message));
  } else {
    testPost(text);
  }
}
