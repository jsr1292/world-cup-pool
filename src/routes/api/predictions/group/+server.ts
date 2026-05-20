import { db } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

const VALID_GROUPS = new Set(['A','B','C','D','E','F','G','H','I','J','K','L']);

// GET /api/predictions/group?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = Number(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Falta prediction_id' }, { status: 400 });

  // Verify ownership
  const pred = db.prepare('SELECT user_id FROM predictions WHERE id = ?').get(predictionId) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  const rows = db.prepare(`
    SELECT group_name, position_1, position_2, position_3, position_4
    FROM group_predictions
    WHERE prediction_id = ?
  `).all(predictionId) as any[];

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
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { prediction_id, groups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };

  if (!prediction_id || !groups) {
    return json({ error: 'Falta prediction_id o grupos' }, { status: 400 });
  }

  // Verify ownership
  const pred = db.prepare('SELECT user_id, pool_id FROM predictions WHERE id = ?').get(prediction_id) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Check deadline
  const pool = db.prepare('SELECT deadline_group FROM pools WHERE id = ?').get(pred.pool_id) as any;
  if (pool?.deadline_group && new Date(pool.deadline_group) <= new Date()) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // Validate group names
  for (const groupName of Object.keys(groups)) {
    if (!VALID_GROUPS.has(groupName)) {
      return json({ error: `Invalid group: ${groupName}` }, { status: 400 });
    }
  }

  // Validate no duplicate teams within a group, and skip groups with no positions filled
  for (const [groupName, positions] of Object.entries(groups)) {
    const filled = [positions.pos1, positions.pos2, positions.pos3, positions.pos4].filter(v => v != null);
    const unique = new Set(filled);
    if (filled.length !== unique.size) {
      return json({ error: `Duplicate team in Group ${groupName}` }, { status: 400 });
    }
  }

  // Validate team IDs belong to their declared group
  for (const [groupName, positions] of Object.entries(groups)) {
    const filled = [positions.pos1, positions.pos2, positions.pos3, positions.pos4]
      .filter((v): v is number => v != null);
    if (filled.length === 0) continue;
    const placeholders = filled.map(() => '?').join(',');
    const valid = db.prepare(
      `SELECT COUNT(*) as cnt FROM teams WHERE group_name = ? AND id IN (${placeholders})`
    ).get(groupName, ...filled) as any;
    if (valid.cnt !== filled.length) {
      return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
    }
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
    for (const [groupName, positions] of Object.entries(groups)) {
      // Always save — even if all null, it means user cleared the group
      // Delete row if all null to keep DB clean, otherwise upsert
      const hasData = positions.pos1 != null || positions.pos2 != null || positions.pos3 != null || positions.pos4 != null;

      if (!hasData) {
        // User cleared this group — delete from DB
        db.prepare('DELETE FROM group_predictions WHERE prediction_id = ? AND group_name = ?').run(prediction_id, groupName);
      } else {
        upsert.run({
          prediction_id,
          group_name: groupName,
          pos1: positions.pos1 ?? null,
          pos2: positions.pos2 ?? null,
          pos3: positions.pos3 ?? null,
          pos4: positions.pos4 ?? null,
        });
      }
    }
  });

  try {
    saveAll();
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Error al guardar' }, { status: 500 });
  }
};
