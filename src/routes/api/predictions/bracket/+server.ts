import { errCode } from '$lib/server/err-code.js';
import { query, getClient } from '$lib/server/db.js';
import {
  getTeamsMapCached,
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

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
    const code = errCode();
    console.error(`[api/predictions/bracket] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// POST /api/predictions/bracket
// Body: { prediction_id, picks: { r32: { 1: teamId, ... }, r16: {...}, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { prediction_id, picks: rawPicks } = body as {
    prediction_id: number;
    picks: Record<string, Record<number, number | null>>;
  };
  const picks = { ...rawPicks }; // mutable copy so we can delete started phases
  const droppedPhases: string[] = [];

  if (!prediction_id || !picks) {
    return json({ error: 'Falta prediction_id o selecciones' }, { status: 400 });
  }

  // Validate each phase value is a non-null object before iterating. Without
  // this, a crafted payload like { picks: { r32: null } } made Object.keys(null)
  // throw an UNHANDLED 500 (this code runs before the try block below).
  for (const [phase, slots] of Object.entries(picks)) {
    if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) {
      return json({ error: `Selecciones inválidas para la fase ${phase}` }, { status: 400 });
    }
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
  const knockoutDeadlinePassed =
    !!poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= new Date();
  if (knockoutDeadlinePassed) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // §2.3 — Per-phase kickoff deadline. A phase is "started" if ANY match has
  // already kicked off (kickoff_time IS NOT NULL AND kickoff_time <= NOW()).
  // If a knockout match has no kickoff_time (NULL), the pool-level
  // deadline_knockout already gates the whole knockout phase above, so we
  // do NOT silently allow that phase through.
  const phases = Object.keys(picks);
  if (phases.length > 0) {
    const { rows: startedRows } = await query(
      `SELECT DISTINCT phase FROM matches
       WHERE phase = ANY($1::text[])
         AND (
           -- #1 — a finished knockout match locks its phase even when
           -- kickoff_time is NULL, so a player can't change bracket picks
           -- after the result is known.
           status = 'finished'
           OR (kickoff_time IS NOT NULL AND kickoff_time <= NOW())
         )`,
      [phases]
    );
    const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
    for (const p of startedPhaseSet) {
      delete (picks as Record<string, unknown>)[p];
      droppedPhases.push(p);
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

  // §2.2 — Reject duplicate team picks within a single phase. A crafted
  // payload could otherwise place the same team in N slots and collect Nx
  // the per-pick points when that team wins.
  for (const [phase, slots] of Object.entries(picks)) {
    const seen = new Set<number>();
    for (const teamId of Object.values(slots)) {
      if (teamId === null) continue;
      if (seen.has(teamId)) {
        return json({ error: `Equipo repetido en fase ${phase}` }, { status: 400 });
      }
      seen.add(teamId);
    }
  }

  // #4 — Reject a team that would end up in two slots of the same phase once
  // THIS save is applied. The §2.2 check only inspects the current request;
  // a separate save (e.g. {final:{2:X}} when slot 1 already holds X) could
  // otherwise leave a team duplicated across slots, which the scoring engine
  // would double-count. We compute the resulting per-phase slot→team map from
  // the DB overlaid with this request's changes and reject duplicates.
  for (const [phase, slots] of Object.entries(picks)) {
    const { rows: existingRows } = await query(
      'SELECT slot, team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = $2',
      [prediction_id, phase]
    );
    const finalMap = new Map<number, number>(); // slot -> team_id (non-null)
    for (const r of existingRows) {
      if (r.team_id !== null) finalMap.set(Number(r.slot), r.team_id as number);
    }
    for (const [slotStr, teamId] of Object.entries(slots)) {
      const slot = Number(slotStr);
      if (teamId === null) finalMap.delete(slot);
      else finalMap.set(slot, teamId);
    }
    const seen = new Set<number>();
    for (const teamId of finalMap.values()) {
      if (seen.has(teamId)) {
        return json({ error: `Equipo repetido en fase ${phase}` }, { status: 400 });
      }
      seen.add(teamId);
    }
  }

  // B5-3: Cross-phase consistency check.
  // Any team picked in a later phase must also appear in the immediately preceding phase.
  const PHASE_PROGRESSION: Record<string, string> = {
    r16: 'r32',
    qf: 'r16',
    sf: 'qf',
    final: 'sf',
    // The 3rd-place match is contested by the two semifinal LOSERS — who are
    // exactly the QF winners that didn't reach the final. The stored 'sf' picks
    // are the semifinal WINNERS (finalists), so validating 3rd-place teams
    // against 'sf' could NEVER pass (a loser is never a winner). They ARE QF
    // winners, so validate against 'qf'.
    '3rd': 'qf',
  };

  // §2.6 — When the client doesn't re-send the preceding phase, hydrate it
  // from the DB so the consistency rule still applies. (The bracket page
  // autosave posts every phase, but external callers and a future entry UI
  // could omit it.)
  const precedingCache: Record<string, Set<number>> = {};
  async function getPrecedingTeams(precedingPhase: string): Promise<Set<number>> {
    if (precedingCache[precedingPhase]) return precedingCache[precedingPhase];
    const inBody = picks[precedingPhase];
    if (inBody) {
      precedingCache[precedingPhase] = new Set(
        Object.values(inBody).filter((id): id is number => id !== null)
      );
      return precedingCache[precedingPhase];
    }
    const { rows } = await query(
      'SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = $2 AND team_id IS NOT NULL',
      [prediction_id, precedingPhase]
    );
    precedingCache[precedingPhase] = new Set(rows.map((r: any) => r.team_id as number));
    return precedingCache[precedingPhase];
  }

  const CANONICAL_PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];
  const sortedPickEntries = Object.entries(picks).sort(
    ([a], [b]) => CANONICAL_PHASE_ORDER.indexOf(a) - CANONICAL_PHASE_ORDER.indexOf(b)
  );
  for (const [phase, slots] of sortedPickEntries) {
    const precedingPhase = PHASE_PROGRESSION[phase];
    if (!precedingPhase) continue;

    const teamsInThisPhase = new Set(
      Object.values(slots).filter((id): id is number => id !== null)
    );
    if (teamsInThisPhase.size === 0) continue;

    const teamsInPrecedingPhase = await getPrecedingTeams(precedingPhase);

    if (teamsInPrecedingPhase.size === 0) {
      return json({
        error: `No hay selecciones previas en (${precedingPhase}) para validar ${phase}`,
      }, { status: 400 });
    }

    for (const teamId of teamsInThisPhase) {
      if (!teamsInPrecedingPhase.has(teamId)) {
        return json({
          error: `Equipo ${teamId} no fue seleccionado en la fase previa (${precedingPhase})`,
        }, { status: 400 });
      }
    }
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

    // §2.11 — If any knockout match is already finished, the user just edited
    // a pick that affects total_score. Rescore inline so the UI reflects
    // the new total immediately, matching the match-scores POST behaviour.
    try {
      const { rows: anyFinished } = await query(
        `SELECT 1 FROM matches
         WHERE phase IN ('r32','r16','qf','sf','final','3rd')
           AND status = 'finished'
         LIMIT 1`
      );
      if (anyFinished.length > 0) {
        await calculateAllScores(pred.pool_id);
        invalidateCachedPoolLeaderboard(pred.pool_id);
        invalidateCachedPoolResults(pred.pool_id);
        invalidateGlobalLeaderboard();
      }
    } catch (e) {
      const code = errCode();
      console.error(`[api/predictions/bracket] rescore ${code}:`, e);
    }

    return json({ ok: true, dropped: droppedPhases });
  } catch (e) {
    await client.query('ROLLBACK');
    const code = errCode();
    console.error(`[api/predictions/bracket] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  } finally {
    client.release();
  }
};
