// ─── Delete Last Message ──────────────────────────────────────────────────────

async function deleteLastMessage(type) {
  const ts = tracker.getTriggerTs(type);
  if (!ts) {
    logger.info(`[Delete] No stored timestamp for "${type}" – nothing to delete`);
    return;
  }
  try {
    const resp = await axios.post('https://slack.com/api/chat.delete', {
      channel: CHANNEL_ID,
      ts,
    }, {
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    if (!resp.data.ok) throw new Error(`Slack API error: ${resp.data.error}`);
    logger.info(`[Delete] ✅ Deleted ${type} message (ts: ${ts})`);
  } catch (err) {
    logger.error(`[Delete] Error: ${err.message}`);
  }
}
