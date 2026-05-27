import { query, getClient } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

const VALID_GROUPS = new Set(['A','B','C','D','E','F','G','H','I','J','K','L']);

// GET /api/predictions/group?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = Number(url.searchParams.get('prediction_id'));
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
    console.error('[api/predictions/group] GET error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

// POST /api/predictions/group
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Rate limit: 30 saves / minute per user
  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  const body = await request.json();
  const { prediction_id, groups: rawGroups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };
  const groups = { ...rawGroups }; // mutable copy so we can delete started groups

  if (!prediction_id || !groups) {
    return json({ error: 'Falta prediction_id o grupos' }, { status: 400 });
  }

  if (Object.keys(groups).length > 32) {
    return json({ error: 'Demasiados grupos' }, { status: 400 });
  }

  // Verify ownership
  const { rows: predRows } = await query('SELECT user_id, pool_id FROM predictions WHERE id = $1', [prediction_id]);
  const pred = predRows[0] ?? null;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Verify pool membership
  const { rows: membership } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [pred.pool_id, locals.user.id]
  );
  if (membership.length === 0) {
    return json({ error: 'No eres miembro de este pool' }, { status: 403 });
  }

  // Check deadline
  const { rows: poolRows } = await query('SELECT deadline_group FROM pools WHERE id = $1', [pred.pool_id]);
  const pool = poolRows[0] ?? null;
  if (pool?.deadline_group && new Date(pool.deadline_group) <= new Date()) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // B4-4: Per-group kickoff deadline — only filter out started groups, don't block entire save
  const groupNames = Object.keys(groups);
  if (groupNames.length > 0) {
    const { rows: startedRows } = await query(
      `SELECT DISTINCT group_name FROM matches
       WHERE group_name = ANY($1::text[])
         AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()`,
      [groupNames]
    );
    const startedGroupSet = new Set(startedRows.map((r: any) => r.group_name));
    for (const g of startedGroupSet) {
      delete (groups as Record<string, unknown>)[g];
    }
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
    const { rows: validRows } = await query(
      `SELECT COUNT(*) as cnt FROM teams WHERE group_name = $1 AND id = ANY($2::int[])`,
      [groupName, filled]
    );
    if (Number(validRows[0].cnt) !== filled.length) {
      return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
    }
  }

  // H-02: Wrap all group saves in a transaction for atomicity
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const [groupName, positions] of Object.entries(groups)) {
      // Always save — even if all null, it means user cleared the group
      // Delete row if all null to keep DB clean, otherwise upsert
      const hasData = positions.pos1 != null || positions.pos2 != null || positions.pos3 != null || positions.pos4 != null;

      if (!hasData) {
        // User cleared this group — delete from DB
        await client.query('DELETE FROM group_predictions WHERE prediction_id = $1 AND group_name = $2', [prediction_id, groupName]);
      } else {
        await client.query(`
          INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT(prediction_id, group_name) DO UPDATE SET
            position_1 = $3,
            position_2 = $4,
            position_3 = $5,
            position_4 = $6
        `, [
          prediction_id,
          groupName,
          positions.pos1 ?? null,
          positions.pos2 ?? null,
          positions.pos3 ?? null,
          positions.pos4 ?? null,
        ]);
      }
    }

    await client.query('COMMIT');

    // B4-6: Detectar grupos guardados con posiciones incompletas (1-3 de 4)
    const partialGroups = Object.entries(groups)
      .filter(([, positions]) => {
        const filled = [positions.pos1, positions.pos2, positions.pos3, positions.pos4]
          .filter((v) => v != null);
        return filled.length > 0 && filled.length < 4;
      })
      .map(([g]) => g);

    return json({
      ok: true,
      ...(partialGroups.length > 0
        ? { advertencia: `Grupos con predicción incompleta: ${partialGroups.join(', ')}` }
        : {}),
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
