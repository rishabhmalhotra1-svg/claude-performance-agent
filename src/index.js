'use strict';

/**
 * KAM Performance Agent – Main Entrypoint
 *
 * Modes:
 *   node src/index.js             → start the daily scheduler
 *   node src/index.js --run-now   → run immediately (for testing / manual trigger)
 *   node src/index.js --dry-run   → run without posting to Slack (prints preview)
 */

require('dotenv').config();

const cron    = require('node-cron');
const logger  = require('./logger');
const { fetchDashboardData } = require('./fetcher');
const { analyzeData }        = require('./analyzer');
const { formatReport, formatEmpty } = require('./formatter');
const { postMessage, postError, testPost } = require('./slack');
const history = require('./history');

const SCHEDULE_HOUR   = parseInt(process.env.SCHEDULE_HOUR   || '19', 10);
const SCHEDULE_MINUTE = parseInt(process.env.SCHEDULE_MINUTE || '0',  10);
const TIMEZONE        = process.env.TIMEZONE || 'Asia/Kolkata';

const args    = process.argv.slice(2);
const RUN_NOW = args.includes('--run-now') || args.includes('-n');
const DRY_RUN = args.includes('--dry-run') || args.includes('-d');

// ─── Core run logic ──────────────────────────────────────────────────────────

async function run() {
  const runAt = new Date();
  logger.info(`=== KAM Performance Agent run started at ${runAt.toISOString()} ===`);

  try {
    // 1. Fetch
    logger.info('Step 1/4 – Fetching dashboard data…');
    const filteredData = await fetchDashboardData();

    // 2. Analyze
    logger.info('Step 2/4 – Analyzing data…');
    const report = analyzeData(filteredData);

    if (report.empty) {
      const msg = formatEmpty(filteredData.fetchedAt);
      logger.warn('No team data found – posting empty-data notification');
      if (DRY_RUN) {
        await testPost(msg);
      } else {
        await postMessage(msg);
      }
      return;
    }

    // Load historical context for trend comparisons
    const prev = history.yesterday(report.date);
    if (prev) {
      logger.info(`Loaded yesterday's snapshot: Stock ${prev.team.stockIns}, Conv ${prev.team.overallConv}%`);
      report.previousDay = prev;
    }
    const lastWk = history.lastWeek(report.date);
    if (lastWk) {
      report.lastWeek = lastWk;
    }

    // 3. Format
    logger.info('Step 3/4 – Formatting Slack message…');
    const message = formatReport(report);

    // 4. Publish
    logger.info('Step 4/4 – Publishing to Slack…');
    if (DRY_RUN) {
      await testPost(message);
      logger.info('Dry-run complete – message NOT sent to Slack');
    } else {
      await postMessage(message);
      logger.info('Slack message published');
    }

    // Save snapshot for future comparisons
    history.save(report);
    logger.info('Snapshot saved to history');

  } catch (err) {
    logger.error(`Agent run failed: ${err.message}`, err);
    if (!DRY_RUN) {
      await postError(err.message, new Date());
    } else {
      console.error('\n[DRY-RUN] Error occurred:', err.message);
    }
    // Non-zero exit only in run-now / dry-run mode so the scheduler keeps running
    if (RUN_NOW || DRY_RUN) process.exit(1);
  }

  logger.info(`=== Agent run completed at ${new Date().toISOString()} ===`);
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function startScheduler() {
  const cronExpr = `${SCHEDULE_MINUTE} ${SCHEDULE_HOUR} * * *`;
  logger.info(
    `Scheduler started – will run daily at ${String(SCHEDULE_HOUR).padStart(2, '0')}:${String(SCHEDULE_MINUTE).padStart(2, '0')} ${TIMEZONE}`
  );
  logger.info(`Cron expression: "${cronExpr}"`);

  if (!cron.validate(cronExpr)) {
    logger.error('Invalid cron expression – check SCHEDULE_HOUR and SCHEDULE_MINUTE env vars');
    process.exit(1);
  }

  cron.schedule(cronExpr, () => {
    logger.info('Scheduled trigger fired');
    run().catch((err) => logger.error(`Unhandled error in scheduled run: ${err.message}`));
  }, { timezone: TIMEZONE });

  logger.info('Scheduler is running. Press Ctrl+C to stop.');

  // Keep process alive
  process.on('SIGINT',  () => { logger.info('Scheduler stopped (SIGINT)');  process.exit(0); });
  process.on('SIGTERM', () => { logger.info('Scheduler stopped (SIGTERM)'); process.exit(0); });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (RUN_NOW || DRY_RUN) {
  run();
} else {
  startScheduler();
}
