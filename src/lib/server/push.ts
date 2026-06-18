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
