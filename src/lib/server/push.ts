/**
 * Web Push (VAPID) — store subscriptions and fan out notifications.
 *
 * Configure via env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and optionally
 * VAPID_SUBJECT (a mailto: or https: contact). Without the keys, push is a
 * graceful no-op (pushConfigured() === false), so the rest of the app is
 * unaffected when it isn't set up.
 */
import webpush from 'web-push';
import { query } from './db.js';
import { shortName } from '../teams.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;   // where notificationclick should take the user
  tag?: string;   // notifications sharing a tag collapse (replace) instead of stacking
}

interface SubRow { endpoint: string; p256dh: string; auth: string; }

let configured: boolean | null = null;
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { configured = false; return false; }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@mundial.local', pub, priv);
    configured = true;
  } catch (e) {
    console.error('[push] invalid VAPID config:', e);
    configured = false;
  }
  return configured;
}

export function pushConfigured(): boolean { return ensureConfigured(); }
export function vapidPublicKey(): string | null { return process.env.VAPID_PUBLIC_KEY ?? null; }

// Quiet hours: suppress AUTOMATIC notifications from 22:30 to 10:00 (Spain time).
// The "Enviar prueba" button bypasses this (it doesn't go through these helpers).
const QUIET_TZ = process.env.QUIET_TZ || 'Europe/Madrid';
const QUIET_START = 22 * 60 + 30; // 22:30
const QUIET_END = 10 * 60;        // 10:00
export function isQuietHours(at: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: QUIET_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const mins = h * 60 + m;
    return mins >= QUIET_START || mins < QUIET_END; // window crosses midnight
  } catch {
    return false; // never block on a TZ error
  }
}

export async function saveSubscription(userId: number, sub: any): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function sendToRows(rows: SubRow[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured() || rows.length === 0) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, data);
      sent++;
    } catch (e: any) {
      // 404/410 → the subscription is dead; prune it so we stop trying.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await removeSubscription(r.endpoint).catch(() => {});
      } else {
        console.error('[push] send error', e?.statusCode ?? e?.message ?? e);
      }
    }
  }));
  return sent;
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<number> {
  const { rows } = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  return sendToRows(rows as SubRow[], payload);
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<number> {
  if (userIds.length === 0) return 0;
  const { rows } = await query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::int[])',
    [userIds]
  );
  return sendToRows(rows as SubRow[], payload);
}

// ── Banter chat ──────────────────────────────────────────────────────────────
// Throttled per pool so a rapid exchange is one ping, not a buzz per line.
const _lastChatNotify = new Map<number, number>();
const CHAT_NOTIFY_THROTTLE_MS = 90_000;

export async function notifyPoolMessage(
  poolId: number, authorId: number, authorName: string, poolName: string, body: string
): Promise<void> {
  if (!ensureConfigured() || isQuietHours()) return;
  const now = Date.now();
  if (now - (_lastChatNotify.get(poolId) ?? 0) < CHAT_NOTIFY_THROTTLE_MS) return;
  _lastChatNotify.set(poolId, now);
  const { rows } = await query(
    'SELECT user_id FROM pool_members WHERE pool_id = $1 AND user_id <> $2',
    [poolId, authorId]
  );
  const ids = rows.map((r: any) => Number(r.user_id));
  if (ids.length === 0) return;
  const text = body.length > 80 ? body.slice(0, 79) + '…' : body;
  await sendPushToUsers(ids, {
    title: `💬 ${poolName}`,
    body: `${authorName}: ${text}`,
    url: `/pool/${poolId}`,
    tag: `chat-${poolId}`,
  });
}

// ── "Match about to start" reminders ─────────────────────────────────────────
// Called from the sync scheduler. Notifies once per fixture, ~within 20 min of
// kickoff. Already-sent ids are remembered in site_settings so a restart or a
// rapid poll doesn't double-fire.
async function loadNotifiedKickoffs(): Promise<Set<number>> {
  try {
    const { rows } = await query("SELECT value FROM site_settings WHERE key = 'notified_kickoffs'");
    const arr = rows[0]?.value ? JSON.parse(rows[0].value) : [];
    return new Set((arr as any[]).map(Number));
  } catch { return new Set(); }
}
async function saveNotifiedKickoffs(ids: Set<number>): Promise<void> {
  try {
    await query(
      `INSERT INTO site_settings (key, value) VALUES ('notified_kickoffs', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify([...ids])]
    );
  } catch { /* best-effort */ }
}

export async function notifyUpcomingMatches(): Promise<void> {
  if (!ensureConfigured() || isQuietHours()) return;
  const { rows } = await query(`
    SELECT m.id, t1.name AS home, t2.name AS away,
           CEIL(EXTRACT(EPOCH FROM (m.kickoff_time - NOW())) / 60)::int AS mins
    FROM matches m
    LEFT JOIN teams t1 ON t1.id = m.home_team_id
    LEFT JOIN teams t2 ON t2.id = m.away_team_id
    WHERE m.kickoff_time IS NOT NULL AND m.status <> 'finished'
      AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
      AND m.kickoff_time > NOW() AND m.kickoff_time <= NOW() + INTERVAL '20 minutes'
  `);
  if (rows.length === 0) return;

  const notified = await loadNotifiedKickoffs();
  const fresh = rows.filter((r: any) => !notified.has(Number(r.id)));
  if (fresh.length === 0) return;

  const { rows: us } = await query('SELECT DISTINCT user_id FROM predictions');
  const userIds = us.map((r: any) => Number(r.user_id));

  for (const m of fresh) {
    const mins = Math.max(1, Number(m.mins) || 1);
    await sendPushToUsers(userIds, {
      title: '⚽ ¡Está a punto de empezar!',
      body: `${shortName(m.home)} – ${shortName(m.away)} empieza en ${mins} min. ¿Cómo lo ves?`,
      url: '/',
      tag: 'kickoff',
    });
    notified.add(Number(m.id));
  }
  await saveNotifiedKickoffs(notified);
}
