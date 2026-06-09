import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db.js';
import { isEmailConfigured, sendPredictionSummaryEmail } from '$lib/server/email.js';
import { buildPredictionSummary } from '$lib/server/prediction-summary.js';
import { checkPredictionRate } from '$lib/server/rate-limit.js';
import { errCode } from '$lib/server/err-code.js';
import { asId } from '$lib/server/json-body.js';

// POST /api/predictions/email-summary  { prediction_id }
// Emails the logged-in user a copy of their own predictions for that entry.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  if (!isEmailConfigured()) {
    return json({ error: 'El envío de correos no está configurado en este servidor.' }, { status: 503 });
  }
  if (!locals.user.email) {
    return json({ error: 'Tu cuenta no tiene email.' }, { status: 400 });
  }
  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const prediction_id = asId((body as { prediction_id?: unknown }).prediction_id);
  if (!prediction_id) return json({ error: 'Falta prediction_id' }, { status: 400 });

  try {
    // Ownership check — only email your own entry.
    const { rows } = await query('SELECT user_id FROM predictions WHERE id = $1', [prediction_id]);
    if (rows.length === 0 || rows[0].user_id !== locals.user.id) {
      return json({ error: 'No es tu predicción' }, { status: 403 });
    }

    const summary = await buildPredictionSummary(prediction_id);
    if (!summary) return json({ error: 'Predicción no encontrada' }, { status: 404 });

    await sendPredictionSummaryEmail(locals.user.email, summary);
    return json({ ok: true, sent_to: locals.user.email });
  } catch (e) {
    if ((e as any)?.code === 'EMAIL_DISABLED') {
      return json({ error: 'El envío de correos no está configurado.' }, { status: 503 });
    }
    const code = errCode();
    console.error(`[api/predictions/email-summary] ${code}:`, e);
    return json({ error: 'No se pudo enviar el correo', code }, { status: 500 });
  }
};
