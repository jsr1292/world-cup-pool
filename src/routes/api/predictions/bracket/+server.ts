import { query, getClient } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

const VALID_PHASES = new Set(['r32', 'r16', 'qf', 'sf', 'final', '3rd']);

// GET /api/predictions/bracket?prediction_id=X
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
      SELECT phase, slot, team_id FROM bracket_predictions
      WHERE prediction_id = $1
      ORDER BY phase, slot
    `, [predictionId]);

    const result: Record<string, Record<number, number>> = {};
    for (const row of rows) {
      if (!result[row.phase]) result[row.phase] = {};
      result[row.phase][row.slot] = row.team_id;
    }

    return json(result);
  } catch (e) {
    console.error('[api/predictions/bracket] GET error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

// POST /api/predictions/bracket
// Body: { prediction_id, picks: { r32: { 1: teamId, ... }, r16: {...}, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { prediction_id, picks } = body as {
    prediction_id: number;
    picks: Record<string, Record<number, number | null>>;
  };

  if (!prediction_id || !picks) {
    return json({ error: 'Falta prediction_id o selecciones' }, { status: 400 });
  }

  // Body size limit: count total pick entries across all phases
  let totalPicks = 0;
  for (const phaseSlots of Object.values(picks)) {
    totalPicks += Object.keys(phaseSlots).length;
  }
  if (totalPicks > 64) {
    return json({ error: 'Demasiadas selecciones' }, { status: 400 });
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
  const { rows: poolRows } = await query('SELECT deadline_knockout FROM pools WHERE id = $1', [pred.pool_id]);
  const poolCheck = poolRows[0] ?? null;
  if (poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= new Date()) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // Per-match kickoff deadline: reject if any knockout match in the relevant phases has started
  const phases = Object.keys(picks);
  if (phases.length > 0) {
    const { rows: started } = await query(
      `SELECT 1 FROM matches WHERE phase = ANY($1::text[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW() LIMIT 1`,
      [phases]
    );
    if (started.length > 0) {
      return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
    }
  }

  // Validate phases
  for (const phase of Object.keys(picks)) {
    if (!VALID_PHASES.has(phase)) {
      return json({ error: `Fase inválida: ${phase}` }, { status: 400 });
    }
  }

  // Max slots per phase: r32=32, r16=16, qf=8, sf=4, final=2, 3rd=2
  const MAX_SLOTS: Record<string, number> = {
    r32: 32, r16: 16, qf: 8, sf: 4, final: 2, '3rd': 2,
  };

  // F-09: Collect all team IDs, validate against cache instead of N+1 queries
  const allTeamIds = new Set<number>();
  for (const [phase, slots] of Object.entries(picks)) {
    const max = MAX_SLOTS[phase] ?? 0;
    for (const [slotStr, teamId] of Object.entries(slots)) {
      const slot = Number(slotStr);
      if (slot < 1 || slot > max) {
        return json({ error: `Posición inválida ${slot} para fase ${phase}` }, { status: 400 });
      }
      if (teamId !== null) allTeamIds.add(teamId);
    }
  }
  const teamsMap = await getTeamsMapCached();
  for (const id of allTeamIds) {
    if (!teamsMap[id]) return json({ error: `Equipo inválido (id: ${id})` }, { status: 400 });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [phase, slots] of Object.entries(picks)) {
      for (const [slotStr, teamId] of Object.entries(slots)) {
        const slot = Number(slotStr);
        if (teamId === null) {
          // Null means clear the slot
          await client.query('DELETE FROM bracket_predictions WHERE prediction_id = $1 AND phase = $2 AND slot = $3', [prediction_id, phase, slot]);
        } else {
          await client.query(`
            INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT(prediction_id, phase, slot) DO UPDATE SET team_id = $4
          `, [prediction_id, phase, slot, teamId]);
        }
      }
    }
    await client.query('COMMIT');
    return json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return json({ error: 'Error al guardar' }, { status: 500 });
  } finally {
    client.release();
  }
};
