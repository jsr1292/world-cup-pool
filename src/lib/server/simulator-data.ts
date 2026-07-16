import { getPoolById, getScoringConfig } from './queries.js';
import { query } from './db.js';
import { getTeamsMapCached } from './cache.js';
import { DEFAULT_SCORING_RULES } from './scoring.js';
import { computeKnockoutOdds, type OddsMatchIn, type OddsEntryIn, type Phase } from '../knockout-odds.js';
import { computeStakes } from '../stakes.js';

// Small process-wide cache for the pool-wide payload (everything except the
// per-request userId). The knockout-odds enumeration + a handful of queries only
// need to run once per minute per pool no matter how many people open the tab —
// important while Neon compute is tight. Standings change only when a match
// finishes, so 60s of staleness is harmless.
const CACHE_TTL = 60_000;
const cache = new Map<number, { at: number; payload: Record<string, any> }>();

// Raw inputs for the "what-if" standings simulator. The projection is computed
// live on the client. Gated to fully locked pools (exposes everyone's picks,
// same rule as stats / viewing bets). Shared by the standalone route loader and
// the /api/pools/[id]/simulator endpoint (used by the inline tab).
export async function getSimulatorData(
  poolId: number, userId: number
): Promise<{ error: string; status: number } | Record<string, any>> {
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) return { error: 'Quiniela no encontrada', status: 404 };
  const pool = await getPoolById(poolId) as any;
  if (!pool) return { error: 'Quiniela no encontrada', status: 404 };

  const { rows: gate } = await query('SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
  if (gate.length === 0 && pool.created_by !== userId) return { error: 'No eres miembro de esta quiniela', status: 403 };

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;
  const safePool = { id: pool.id, name: pool.name, allow_multiple_predictions: pool.allow_multiple_predictions, buy_in: pool.buy_in, currency: pool.currency };

  if (!betsLocked) {
    return { pool: safePool, betsLocked: false, teams: {}, entries: [], matches: [], picks: {}, orders: {}, matchOutcomePts: 0, groupPositionPts: 0, odds: [], oddsMeta: null, stakes: null, koMatches: [], bracketEntries: [], knockoutRules: {}, userId };
  }

  const cached = cache.get(poolId);
  if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached.payload, userId };

  const scoring = { ...DEFAULT_SCORING_RULES, ...(await getScoringConfig(poolId)) };
  const matchOutcomePts = Number(scoring.match_outcome) || 0;
  const groupPositionPts = Number(scoring.group_position) || 0;

  const teams = await getTeamsMapCached();

  const { rows: entriesRaw } = await query(
    `SELECT p.id, p.user_id, u.display_name, p.label, p.total_score
     FROM predictions p JOIN users u ON u.id = p.user_id
     WHERE p.pool_id = $1 ORDER BY p.total_score DESC, u.display_name`, [poolId]
  );
  const entries = entriesRaw.map((e: any) => ({
    id: Number(e.id), user_id: Number(e.user_id), display_name: e.display_name,
    label: e.label || null, total_score: Number(e.total_score) || 0,
  }));

  const { rows: matchesRaw } = await query(
    `SELECT id, group_name, home_team_id, away_team_id, kickoff_time, status, home_score, away_score, sort_order
     FROM matches WHERE phase = 'group'
     ORDER BY kickoff_time NULLS LAST, sort_order`
  );
  const matches = matchesRaw.map((m: any) => ({
    id: Number(m.id), group_name: m.group_name,
    home_team_id: m.home_team_id, away_team_id: m.away_team_id,
    kickoff_time: m.kickoff_time instanceof Date ? m.kickoff_time.toISOString() : (m.kickoff_time ? String(m.kickoff_time) : null),
    status: m.status, home_score: m.home_score, away_score: m.away_score,
  }));

  const { rows: mpRows } = await query(
    `SELECT mp.prediction_id AS pid, mp.match_id AS mid, mp.home_score AS ph, mp.away_score AS pa
     FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id
     JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
     WHERE p.pool_id = $1 AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL`, [poolId]
  );
  const picks: Record<number, Record<number, string>> = {};
  for (const r of mpRows) { (picks[r.pid] ??= {})[r.mid] = r.ph > r.pa ? '1' : r.ph < r.pa ? '2' : 'X'; }

  const orders: Record<number, Record<string, number[]>> = {};
  if (groupPositionPts > 0) {
    const { rows: gpRows } = await query(
      `SELECT gp.prediction_id AS pid, gp.group_name AS g, gp.position_1 AS p1, gp.position_2 AS p2, gp.position_3 AS p3, gp.position_4 AS p4
       FROM group_predictions gp JOIN predictions p ON p.id = gp.prediction_id
       WHERE p.pool_id = $1`, [poolId]
    );
    for (const r of gpRows) { (orders[r.pid] ??= {})[r.g] = [r.p1, r.p2, r.p3, r.p4]; }
  }

  // ── Knockout win/podium probabilities ──────────────────────────────────────
  // Enumerate every still-possible outcome of the remaining knockout matches and
  // report each member's chance of finishing 1st / top-3. Runs only once the
  // knockout bracket exists.
  let odds: any[] = [];
  let oddsMeta: any = null;
  let stakes: any = null;    // "qué se juega" certainties (champions / decisive games)
  let koMatchesOut: any[] = [];      // for the interactive what-if bracket
  let bracketEntries: any[] = [];    // per-entry base + picks (client scores a chosen scenario)
  const knockoutRules: Record<string, number> = {
    knockout_r32: Number(scoring.knockout_r32) || 0, knockout_r16: Number(scoring.knockout_r16) || 0,
    knockout_qf: Number(scoring.knockout_qf) || 0, knockout_sf: Number(scoring.knockout_sf) || 0,
    knockout_final: Number(scoring.knockout_final) || 0, knockout_winner: Number(scoring.knockout_winner) || 0,
    third_place: Number(scoring.third_place) || 0,
  };
  const { rows: koRows } = await query(
    `SELECT id, phase, sort_order, status, home_team_id, away_team_id, home_score, away_score, penalty_winner_id, kickoff_time
     FROM matches WHERE phase IN ('r32','r16','qf','sf','3rd','final')
     ORDER BY phase, sort_order`
  );
  // KO template rows (r32..final). Pre-draw these have null teams — fine, the
  // client builds R32 participants from the projected group tables.
  const idxByPhase: Record<string, number> = {};
  const koMatches: OddsMatchIn[] = koRows.map((m: any) => {
    const i = (idxByPhase[m.phase] = (idxByPhase[m.phase] ?? -1) + 1);
    return {
      phase: m.phase as Phase, index: i,
      finished: m.status === 'finished' && m.home_score != null && m.away_score != null,
      homeTeamId: m.home_team_id, awayTeamId: m.away_team_id,
      homeScore: m.home_score, awayScore: m.away_score, penaltyWinnerId: m.penalty_winner_id ?? null,
    };
  });
  // Parallel to koMatches: db id + kickoff for the stakes banner display.
  const koMeta = koRows.map((m: any) => ({
    id: Number(m.id),
    kickoff: m.kickoff_time instanceof Date ? m.kickoff_time.toISOString() : (m.kickoff_time ? String(m.kickoff_time) : null),
  }));

  // Per-entry fixed inputs: base = total_score minus already-earned knockout
  // points (so we can re-add the full simulated knockout total), plus the
  // fixed correct-pick count (group correct) for the ranking tiebreak, plus
  // their bracket picks.
  const { rows: koPtsRows } = await query(
    `SELECT bp.prediction_id AS pid, COALESCE(SUM(bp.points_earned), 0) AS pts
     FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
     WHERE p.pool_id = $1 GROUP BY bp.prediction_id`, [poolId]
  );
  const koPtsByPred: Record<number, number> = {};
  for (const r of koPtsRows) koPtsByPred[r.pid] = Number(r.pts) || 0;

  const { rows: gcRows } = await query(
    `SELECT mp.prediction_id AS pid, COUNT(*) FILTER (WHERE mp.points_earned > 0) AS cnt
     FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id
     WHERE p.pool_id = $1 GROUP BY mp.prediction_id`, [poolId]
  );
  const groupCorrectByPred: Record<number, number> = {};
  for (const r of gcRows) groupCorrectByPred[r.pid] = Number(r.cnt) || 0;

  const { rows: bpRows } = await query(
    `SELECT bp.prediction_id AS pid, bp.phase, bp.slot, bp.team_id
     FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
     WHERE p.pool_id = $1`, [poolId]
  );
  const picksByPred: Record<number, { phase: string; slot: number; teamId: number | null }[]> = {};
  for (const r of bpRows) (picksByPred[r.pid] ??= []).push({ phase: r.phase, slot: Number(r.slot), teamId: r.team_id });

  const oddsEntries: OddsEntryIn[] = entries.map((e) => ({
    id: e.id, userId: e.user_id, name: e.display_name, label: e.label,
    base: e.total_score - (koPtsByPred[e.id] ?? 0),
    baseCorrect: groupCorrectByPred[e.id] ?? 0,
    picks: picksByPred[e.id] ?? [],
  }));

  koMatchesOut = koMatches;
  bracketEntries = oddsEntries;

  // Odds enumeration is the expensive part and only meaningful once R32 is done.
  const r32Rows = koRows.filter((m: any) => m.phase === 'r32');
  const r32AllDone = r32Rows.length > 0 && r32Rows.every((m: any) => m.status === 'finished' && m.home_score != null);
  if (r32AllDone) {
    const result = computeKnockoutOdds(koMatches, oddsEntries, scoring);
    odds = result.rows;
    oddsMeta = { scenarios: result.scenarios, remaining: result.remaining, exact: result.exact };
    stakes = computeStakes(koMatches, oddsEntries, scoring, koMeta, (id: number) => ({
      name: (teams as Record<number, any>)[id]?.name ?? '?',
      flag: (teams as Record<number, any>)[id]?.flag_code ?? '',
    }), { pot: (Number(pool.buy_in) || 0) * entries.length });
  }

  const payload = { pool: safePool, betsLocked: true, teams, entries, matches, picks, orders, matchOutcomePts, groupPositionPts, odds, oddsMeta, stakes, koMatches: koMatchesOut, bracketEntries, knockoutRules };
  cache.set(poolId, { at: Date.now(), payload });
  return { ...payload, userId };
}
