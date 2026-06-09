import { errCode } from '$lib/server/err-code.js';
import { asId } from '$lib/server/json-body.js';
import { query } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

// GET /api/predictions/group?prediction_id=X
// Returns the (derived) group standings for a prediction. Still used as a
// read API; writing is no longer accepted here (see POST below).
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = asId(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Falta prediction_id' }, { status: 400 });

  try {
    // Verify ownership
    const { rows: predRows } = await query('SELECT user_id FROM predictions WHERE id = $1', [predictionId]);
    const pred = predRows[0] ?? null;
    if (!pred || pred.user_id !== locals.user.id) {
      return json({ error: 'No es tu predicción' }, { status: 403 });
    }

    const { rows } = await query(`
      SELECT group_name, position_1, position_2, position_3, position_4
      FROM group_predictions
      WHERE prediction_id = $1
    `, [predictionId]);

    const result: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};
    for (const row of rows) {
      result[row.group_name] = {
        pos1: row.position_1,
        pos2: row.position_2,
        pos3: row.position_3,
        pos4: row.position_4,
      };
    }
    return json(result);
  } catch (e) {
    const code = errCode();
    console.error(`[api/predictions/group] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// POST is DEPRECATED and refuses writes (410 Gone). Group standings are no longer
// set directly — they are DERIVED from each player's predicted scorelines and
// written by the match-scores endpoint (/api/predictions/match-scores). Accepting
// hand-set positions here would let a stale/rogue client persist a table that
// contradicts the player's scorelines and mis-score the group until the next
// scoreline edit overwrote it. Kept as an explicit 410 so any old client gets a
// clear signal rather than silently corrupting data.
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  return json(
    { error: 'Obsoleto: la clasificación de grupos se calcula a partir de los marcadores.' },
    { status: 410 }
  );
};
