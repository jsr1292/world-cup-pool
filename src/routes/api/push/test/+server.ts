import { json, type RequestHandler } from '@sveltejs/kit';
import { pushConfigured, sendPushToUser } from '$lib/server/push.js';

// POST /api/push/test — send a test notification to the caller's own devices.
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  if (!pushConfigured()) return json({ error: 'Push no está configurado en el servidor' }, { status: 503 });
  const sent = await sendPushToUser(locals.user.id, {
    title: '🏆 Mundial 2026',
    body: 'Notificaciones activadas. Te avisaremos de los resultados.',
    url: '/',
    tag: 'test',
  });
  return json({ ok: true, sent });
};
