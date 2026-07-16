import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';
import { computeAttribution, type ItemPoints } from '$lib/h2h-attribution.js';
import { shortName } from '$lib/teams.js';
import { rankGroup, type GsMatch } from '$lib/group-standings.js';
import type { PageServerLoad } from './$types.js';

// Head-to-head: compare two entries' predictions side by side. Gated to fully
// locked pools (same rule as viewing bets / stats).
export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');

  const poolId = Number(params.id);
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) throw error(404, 'Quiniela no encontrada');
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) throw error(403, 'No eres miembro de esta quiniela');

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;
  const safePool = { id: pool.id, name: pool.name, allow_multiple_predictions: pool.allow_multiple_predictions };

  if (!betsLocked) return { pool: safePool, betsLocked: false, entries: [], a: null, b: null, teams: {}, attribution: null, actualGroupWinners: {}, actualChampion: null };

  const { rows: entries } = await query(
    `SELECT p.id, u.display_name, p.label FROM predictions p JOIN users u ON u.id = p.user_id
     WHERE p.pool_id = $1 ORDER BY u.display_name, p.id`, [poolId]
  );
  const ids = new Set(entries.map((e: any) => Number(e.id)));

  const mine = await getUserPredictions(poolId, locals.user.id) as any[];
  const aId = pickId(url.searchParams.get('a'), ids) ?? (mine[0] ? Number(mine[0].id) : null);
  const bId = pickId(url.searchParams.get('b'), ids);

  const teams = await getTeamsMapCached();
  const a = aId ? await sideFor(aId, entries) : null;
  const b = bId ? await sideFor(bId, entries) : null;

  // Shared list of group fixtures (chronological) so the view can compare both
  // sides' 1/X/2 pick per match under date headers.
  const { rows: groupMatches } = await query(`
    SELECT id, group_name, home_team_id, away_team_id, kickoff_time, status, home_score, away_score
    FROM matches WHERE phase = 'group'
    ORDER BY kickoff_time NULLS LAST, sort_order
  `);

  // Actual group winners, once a group's 6 matches are finished — mirrors the
  // exact rankGroup() logic that scores the real table (scoring.ts), so the
  // ✓/✗ marks below can never disagree with the live scoring engine. Read-only,
  // derived from the groupMatches already fetched above.
  const actualGroupWinners: Record<string, number> = {};
  {
    const byGroup: Record<string, GsMatch[]> = {};
    const finishedCount: Record<string, number> = {};
    for (const m of groupMatches) {
      if (!m.group_name) continue;
      finishedCount[m.group_name] = (finishedCount[m.group_name] ?? 0) + (m.status === 'finished' ? 1 : 0);
      if (m.status === 'finished' && m.home_score != null && m.away_score != null) {
        (byGroup[m.group_name] ??= []).push({
          homeTeamId: m.home_team_id, awayTeamId: m.away_team_id,
          homeScore: m.home_score, awayScore: m.away_score,
        });
      }
    }
    for (const [g, ms] of Object.entries(byGroup)) {
      if (finishedCount[g] !== 6) continue; // only rank a completed group (matches scoring.ts)
      actualGroupWinners[g] = rankGroup(ms)[0];
    }
  }

  // Actual champion, once the final is finished (same winner rule as
  // calculateBracketScores in scoring.ts). Read-only SELECT.
  const { rows: finalRows } = await query(`
    SELECT home_team_id, away_team_id, home_score, away_score, penalty_winner_id
    FROM matches WHERE phase = 'final' AND status = 'finished'
      AND home_score IS NOT NULL AND away_score IS NOT NULL LIMIT 1
  `);
  const fm = finalRows[0];
  const actualChampion: number | null = fm
    ? (fm.home_score > fm.away_score ? fm.home_team_id
      : fm.home_score < fm.away_score ? fm.away_team_id
      : fm.penalty_winner_id ?? null)
    : null;

  let attribution = null;
  if (aId && bId) {
    const ai = await itemPointsFor(aId);
    const bi = await itemPointsFor(bId);
    const tName = (id: number | null) => (id != null && teams[id]?.name ? shortName(teams[id].name) : '—');
    const PHASE_LABEL: Record<string, string> = {
      r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', final: 'Campeón', '3rd': '3er puesto',
    };
    const items: ItemPoints[] = [];

    // Resultados — one item per group fixture (chronological list already loaded).
    for (const m of groupMatches) {
      const you = ai.matchPts[m.id] ?? 0, them = bi.matchPts[m.id] ?? 0;
      items.push({
        key: `res:${m.id}`, category: 'resultados',
        label: `${tName(m.home_team_id)}–${tName(m.away_team_id)}`,
        you, them,
      });
    }
    // Posición — one item per group A..L (union of both sides' group rows).
    for (const g of new Set([...Object.keys(ai.groupPts), ...Object.keys(bi.groupPts)])) {
      items.push({
        key: `pos:${g}`, category: 'posicion', label: `Grupo ${g} · posición`,
        you: ai.groupPts[g] ?? 0, them: bi.groupPts[g] ?? 0,
      });
    }
    // Eliminatorias — one item per (phase, slot); label by whichever side scored.
    for (const k of new Set([...Object.keys(ai.bracket), ...Object.keys(bi.bracket)])) {
      const you = ai.bracket[k]?.pts ?? 0, them = bi.bracket[k]?.pts ?? 0;
      const phase = k.split(':')[0];
      const scorerTeam = you >= them ? ai.bracket[k]?.teamId : bi.bracket[k]?.teamId;
      items.push({
        key: `ko:${k}`, category: 'eliminatorias',
        label: `${PHASE_LABEL[phase] ?? phase} · ${tName(scorerTeam ?? null)}`,
        you, them,
      });
    }
    attribution = computeAttribution(items);
  }

  return { pool: safePool, betsLocked: true, entries, a, b, teams, groupMatches, attribution, actualGroupWinners, actualChampion };
};

function pickId(raw: string | null, ids: Set<number>): number | null {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return n && ids.has(n) ? n : null;
}

async function itemPointsFor(pid: number) {
  const matchPts: Record<number, number> = {};
  for (const r of (await query(
    `SELECT mp.match_id AS mid, mp.points_earned AS pts
     FROM match_predictions mp JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
     WHERE mp.prediction_id = $1`, [pid]
  )).rows) matchPts[Number(r.mid)] = Number(r.pts) || 0;

  const groupPts: Record<string, number> = {};
  for (const r of (await query(
    `SELECT group_name AS g, points_earned AS pts FROM group_predictions WHERE prediction_id = $1`, [pid]
  )).rows) groupPts[r.g] = Number(r.pts) || 0;

  // Knockout keyed by "phase:slot", carrying the picked team for labels.
  const bracket: Record<string, { teamId: number | null; pts: number }> = {};
  for (const r of (await query(
    `SELECT phase, slot, team_id, points_earned AS pts FROM bracket_predictions WHERE prediction_id = $1`, [pid]
  )).rows) bracket[`${r.phase}:${r.slot}`] = { teamId: r.team_id, pts: Number(r.pts) || 0 };

  return { matchPts, groupPts, bracket };
}

async function sideFor(pid: number, entries: any[]) {
  const meta = entries.find((e) => Number(e.id) === pid);
  const champion = (await query(
    `SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = 'final' AND team_id IS NOT NULL LIMIT 1`, [pid]
  )).rows[0]?.team_id ?? null;
  const finalists = (await query(
    `SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = 'sf' AND team_id IS NOT NULL ORDER BY slot`, [pid]
  )).rows.map((r: any) => r.team_id);
  const gw: Record<string, number> = {};
  for (const r of (await query(
    `SELECT group_name, position_1 FROM group_predictions WHERE prediction_id = $1 AND position_1 IS NOT NULL`, [pid]
  )).rows) gw[r.group_name] = r.position_1;
  const tb = (await query('SELECT home_score, away_score FROM tiebreaker WHERE prediction_id = $1', [pid])).rows[0] ?? null;
  // Points breakdown so the header can show why each side totals what it does
  // (mirrors the Clasificación pills): resultados 1/X/2 + posición tabla + elim.
  const pts = (await query(`
    SELECT
      (SELECT COALESCE(SUM(points_earned), 0) FROM match_predictions WHERE prediction_id = $1) AS result_pts,
      (SELECT COALESCE(SUM(points_earned), 0) FROM group_predictions WHERE prediction_id = $1) AS position_pts,
      (SELECT COALESCE(SUM(points_earned), 0) FROM bracket_predictions WHERE prediction_id = $1) AS knockout_pts
  `, [pid])).rows[0] ?? {};
  const resultPoints = Number(pts.result_pts ?? 0);
  const positionPoints = Number(pts.position_pts ?? 0);
  const knockoutPoints = Number(pts.knockout_pts ?? 0);
  // Per-match group picks as 1/X/2 (derived from the stored canonical scoreline),
  // keyed by match id for side-by-side comparison.
  const groupPicks: Record<number, '1' | 'X' | '2'> = {};
  for (const r of (await query(
    `SELECT mp.match_id, mp.home_score AS ph, mp.away_score AS pa
     FROM match_predictions mp JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
     WHERE mp.prediction_id = $1`, [pid]
  )).rows) {
    groupPicks[r.match_id] = r.ph > r.pa ? '1' : r.ph < r.pa ? '2' : 'X';
  }
  return {
    id: pid,
    owner: meta?.display_name ?? '?',
    label: meta?.label || null,
    champion, finalists, groupWinners: gw, groupPicks,
    tiebreaker: tb ? { home: tb.home_score, away: tb.away_score } : null,
    resultPoints, positionPoints, knockoutPoints,
    totalScore: resultPoints + positionPoints + knockoutPoints,
  };
}
