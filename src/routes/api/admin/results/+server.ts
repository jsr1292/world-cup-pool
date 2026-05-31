import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
import { runWithConcurrency } from '$lib/server/concurrency.js';

// POST /api/admin/results
// Body: { match_id, home_score, away_score }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const {
      match_id, home_score, away_score, penalty_winner_id = null,
      home_team_id = null, away_team_id = null,
    } = body as {
      match_id: number; home_score: number; away_score: number; penalty_winner_id?: number | null;
      home_team_id?: number | null; away_team_id?: number | null;
    };

    if (match_id == null || home_score == null || away_score == null) {
      return json({ error: 'Faltan campos' }, { status: 400 });
    }

    if (
      !Number.isInteger(home_score) || !Number.isInteger(away_score) ||
      home_score < 0 || away_score < 0 ||
      home_score > 30 || away_score > 30
    ) {
      return json({ error: 'Marcador inválido' }, { status: 400 });
    }

    // Optional team assignment — used for knockout matches whose teams are not
    // known until the bracket fills. Group matches never send these. Must be
    // sent as a pair (both or neither) and reference two distinct real teams.
    const assignTeams = home_team_id !== null || away_team_id !== null;
    if (assignTeams) {
      if (home_team_id === null || away_team_id === null) {
        return json({ error: 'Indica ambos equipos o ninguno' }, { status: 400 });
      }
      if (!Number.isInteger(home_team_id) || !Number.isInteger(away_team_id)) {
        return json({ error: 'Equipos inválidos' }, { status: 400 });
      }
      if (home_team_id === away_team_id) {
        return json({ error: 'Los dos equipos deben ser distintos' }, { status: 400 });
      }
    }

    // Verify user is admin
    const { rows: actorRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const actor = actorRows[0] ?? null;
    if (!actor?.is_admin) {
      return json({ error: 'Solo los administradores pueden modificar resultados' }, { status: 403 });
    }

    // Get match
    const { rows: matchRows } = await query('SELECT * FROM matches WHERE id = $1', [match_id]);
    const match = matchRows[0] ?? null;
    if (!match) return json({ error: 'Partido no encontrado' }, { status: 404 });

    // Confirm the assigned teams exist before using them.
    if (assignTeams) {
      const { rows: teamRows } = await query(
        'SELECT id FROM teams WHERE id = ANY($1::int[])',
        [[home_team_id, away_team_id]]
      );
      if (teamRows.length !== 2) {
        return json({ error: 'Equipo no encontrado' }, { status: 404 });
      }
    }

    // Effective teams after this update — used to validate the penalty winner.
    const effHome = assignTeams ? home_team_id : match.home_team_id;
    const effAway = assignTeams ? away_team_id : match.away_team_id;

    // §2.5 — Validate penalty_winner_id:
    //   - only allowed when the match ends in a draw,
    //   - must equal one of the two teams.
    if (penalty_winner_id !== null) {
      if (home_score !== away_score) {
        return json({ error: 'penalty_winner sólo en empates' }, { status: 400 });
      }
      if (
        penalty_winner_id !== effHome &&
        penalty_winner_id !== effAway
      ) {
        return json({ error: 'penalty_winner_id no coincide con los equipos del partido' }, { status: 400 });
      }
    }

    // Update match result (penalty_winner_id is NULL for normal wins, set for penalty shootout deciders).
    // When teams are assigned (knockout), set them in the same statement.
    if (assignTeams) {
      await query(
        "UPDATE matches SET home_team_id = $5, away_team_id = $6, home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
        [home_score, away_score, match_id, penalty_winner_id, home_team_id, away_team_id]
      );
    } else {
      await query(
        "UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
        [home_score, away_score, match_id, penalty_winner_id]
      );
    }

    await logAudit('update_result', locals.user.id, 'match', match_id, { home_score: match.home_score, away_score: match.away_score }, { home_score, away_score });

    // §2.6 — Score pools concurrently (cap 3) so manual results don't
    // produce a request that blocks for the sequential sum of all pools.
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    const poolIds = pools.map((p: any) => p.id);

    await runWithConcurrency(poolIds, 3, async (poolId) => {
      // §2.9 — Re-check is_active to match sync-scores semantics.
      const { rows: stillActive } = await query(
        'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
        [poolId]
      );
      if (stillActive.length === 0) return;
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[score] admin/results pool ${poolId}:`, e);
      }
    });
    invalidateGlobalLeaderboard();

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/results] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
