import { query } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';
import { getCachedGlobalLeaderboard, setCachedGlobalLeaderboard } from '$lib/server/cache.js';

export const load: PageServerLoad = async ({ locals }) => {
  const currentUserId = locals.user?.id;

  const cached = getCachedGlobalLeaderboard();
  if (cached) return { leaderboard: cached, currentUserId };

  // Get the actual final match score for tiebreaker closeness
  const { rows: fmRows } = await query(`
    SELECT home_score, away_score FROM matches
    WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
    LIMIT 1
  `);
  const finalMatch = fmRows[0] ?? null;

  // Build tiebreaker expression for ORDER BY
  let orderByTiebreaker = '0'; // no-op if no final yet
  if (finalMatch) {
    // Guard: only interpolate if both scores are valid integers.
    // Math.trunc(Number(undefined)) = NaN, which produces invalid SQL.
    const hRaw = Math.trunc(Number(finalMatch.home_score));
    const aRaw = Math.trunc(Number(finalMatch.away_score));
    if (Number.isInteger(hRaw) && Number.isInteger(aRaw)) {
      // Safe to interpolate: both values are confirmed integers from our own DB.
      orderByTiebreaker = `(
        COALESCE(ABS(tb.home_score - ${hRaw}) + ABS(tb.away_score - ${aRaw}), 9999)
      )`;
    }
    // If scores are not valid integers (e.g. NULL coerced to NaN),
    // keep orderByTiebreaker = '0' — leaderboard works without tiebreaker.
  }

  // Get top 100 scorers across all pools, using pre-aggregated CTEs (F-10)
  const { rows } = await query(`
    WITH tiebreaker_close AS (
      SELECT prediction_id, ${orderByTiebreaker} as closeness
      FROM tiebreaker tb
    ),
    exact_hits AS (
      -- #8 — true exact-scoreline hits (config-independent): a prediction whose
      -- score equals the finished match actual score. The old points_earned
      -- >= 7 threshold was unreachable under default rules (max 4), so this
      -- tiebreaker never fired.
      SELECT mp.prediction_id, COUNT(*) as exact_score_hits
      FROM match_predictions mp
      JOIN matches m ON m.id = mp.match_id
        AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      WHERE mp.home_score = m.home_score AND mp.away_score = m.away_score
      GROUP BY mp.prediction_id
    ),
    group_correct AS (
      SELECT prediction_id, COUNT(*) as cnt
      FROM group_predictions WHERE points_earned > 0
      GROUP BY prediction_id
    ),
    bracket_correct AS (
      SELECT prediction_id, COUNT(*) as cnt
      FROM bracket_predictions WHERE points_earned > 0
      GROUP BY prediction_id
    )
    SELECT
      u.id as user_id,
      u.username,
      u.display_name,
      COUNT(DISTINCT p.pool_id) as pools_count,
      SUM(p.total_score) as total_score,
      SUM(COALESCE(gc.cnt, 0) + COALESCE(bc.cnt, 0)) as total_correct,
      COALESCE(SUM(eh.exact_score_hits), 0) as exact_score_hits
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN tiebreaker_close tc ON tc.prediction_id = p.id
    LEFT JOIN exact_hits eh ON eh.prediction_id = p.id
    LEFT JOIN group_correct gc ON gc.prediction_id = p.id
    LEFT JOIN bracket_correct bc ON bc.prediction_id = p.id
    GROUP BY u.id
    -- #10 — Canonical tiebreak chain, unified with the pool leaderboard, ending
    -- in deterministic keys so equal users always order the same way.
    ORDER BY total_score DESC,
             exact_score_hits DESC,
             total_correct DESC,
             MIN(tc.closeness) ASC NULLS LAST,
             MAX(p.updated_at) ASC,
             u.id ASC
    LIMIT 100
  `);

  const leaderboard = rows.map((row, i) => ({
    rank: i + 1,
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name || row.username,
    pools_count: row.pools_count,
    total_score: row.total_score || 0,
    total_correct: row.total_correct || 0,
    exact_score_hits: row.exact_score_hits || 0,
  }));

  setCachedGlobalLeaderboard(leaderboard);
  return { leaderboard, currentUserId };
};
