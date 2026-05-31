/**
 * Automatic prediction-confirmation emails. When a pool's group deadline
 * passes, each member with an email gets a one-time "you're locked in — here's
 * what you predicted" message. Tracked via predictions.summary_emailed_at so it
 * sends at most once per entry. No-op unless SMTP is configured.
 */
import { query } from './db.js';
import { isEmailConfigured, sendPredictionSummaryEmail } from './email.js';
import { buildPredictionSummary } from './prediction-summary.js';

/** Send confirmations for predictions in pools whose group deadline has passed. */
export async function notifyLockedPredictions(batch = 50): Promise<{ sent: number; failed: number }> {
  if (!isEmailConfigured()) return { sent: 0, failed: 0 };

  const { rows } = await query(
    `SELECT p.id, u.email
     FROM predictions p
     JOIN pools po ON po.id = p.pool_id
     JOIN users u ON u.id = p.user_id
     WHERE po.is_active = true
       AND po.deadline_group IS NOT NULL AND po.deadline_group <= NOW()
       AND p.summary_emailed_at IS NULL
       AND u.email IS NOT NULL AND u.email <> ''
     ORDER BY p.id
     LIMIT $1`,
    [batch]
  );

  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      const summary = await buildPredictionSummary(r.id);
      if (!summary || !summary.email) continue;
      await sendPredictionSummaryEmail(summary.email, summary, { locked: true });
      // Mark only after a successful send so transient failures retry next tick.
      await query('UPDATE predictions SET summary_emailed_at = NOW() WHERE id = $1', [r.id]);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[notifications] failed to email prediction ${r.id}:`, e);
    }
  }
  if (sent > 0) console.log(`[notifications] sent ${sent} lock confirmation(s).`);
  return { sent, failed };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the lock-confirmation poller. No-op unless SMTP is configured. */
export function startNotificationScheduler(): void {
  if (timer) return;
  if (!isEmailConfigured()) return;
  const intervalMs = 5 * 60_000; // every 5 min — deadlines are coarse

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await notifyLockedPredictions();
    } catch (e) {
      console.error('[notifications] poll failed:', e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 30_000);
  timer = setInterval(tick, intervalMs);
  console.log('[notifications] lock-confirmation emails enabled (every 5 min).');
}
