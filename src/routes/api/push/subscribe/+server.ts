import { json, type RequestHandler } from '@sveltejs/kit';
import { saveSubscription } from '$lib/server/push.js';

// POST /api/push/subscribe — body is a PushSubscription JSON.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const sub = await request.json().catch(() => null);
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return json({ error: 'Suscripción inválida' }, { status: 400 });
  }
  await saveSubscription(locals.user.id, sub);
  return json({ ok: true });
};
