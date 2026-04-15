import { db } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

// GET /api/predictions/group?prediction_id=X
export const GET: RequestHandler = async ({ url }) => {
  const predictionId = Number(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Missing prediction_id' }, { status: 400 });

  const rows = db.prepare(`
    SELECT group_name, position_1, position_2, position_3, position_4
    FROM group_predictions
    WHERE prediction_id = ?
  `).all(predictionId) as any[];

  // Map to { group_A: { pos1: teamId, pos2: teamId, ... }, ... }
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
};

// POST /api/predictions/group
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { prediction_id, groups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };

  if (!prediction_id || !groups) {
    return json({ error: 'Missing prediction_id or groups' }, { status: 400 });
  }

  const upsert = db.prepare(`
    INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4)
    VALUES (@prediction_id, @group_name, @pos1, @pos2, @pos3, @pos4)
    ON CONFLICT(prediction_id, group_name) DO UPDATE SET
      position_1 = @pos1,
      position_2 = @pos2,
      position_3 = @pos3,
      position_4 = @pos4
  `);

  const saveAll = db.transaction(() => {
    for (const [group_name, positions] of Object.entries(groups)) {
      upsert.run({
        prediction_id,
        group_name,
        pos1: positions.pos1 ?? null,
        pos2: positions.pos2 ?? null,
        pos3: positions.pos3 ?? null,
        pos4: positions.pos4 ?? null,
      });
    }
  });

  try {
    saveAll();
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Save failed' }, { status: 500 });
  }
};
