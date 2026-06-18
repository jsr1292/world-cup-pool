import { json, type RequestHandler } from '@sveltejs/kit';
import { removeSubscription } from '$lib/server/push.js';

// POST /api/push/unsubscribe — body: { endpoint }.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) return json({ error: 'Falta endpoint' }, { status: 400 });
  await removeSubscription(body.endpoint);
  return json({ ok: true });
};
