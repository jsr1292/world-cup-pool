import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const currentUserId = locals.user?.id;
  // Get the actual final match score for tiebreaker closeness
  const finalMatch = db.prepare(`
    SELECT home_score, away_score FROM matches
    WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
    LIMIT 1
  `).get() as any;

  // Build tiebreaker expression for ORDER BY
  let orderByTiebreaker = '0'; // no-op if no final yet
  if (finalMatch) {
    // Smaller closeness = better: sum of absolute differences
    const h = Math.trunc(Number(finalMatch.home_score));
    const a = Math.trunc(Number(finalMatch.away_score));
    orderByTiebreaker = `(
      COALESCE(ABS(tb.home_score - ${h}) + ABS(tb.away_score - ${a}), 9999)
    )`;
  }

  // Get top 50 scorers across all pools, using a CTE for tiebreaker join
  const rows = db.prepare(`
    WITH tiebreaker_close AS (
      SELECT prediction_id, ${orderByTiebreaker} as closeness
      FROM tiebreaker tb
    ),
    exact_hits AS (
      SELECT prediction_id,
        SUM(CASE WHEN points_earned >= 7 THEN 1 ELSE 0 END) as exact_score_hits
      FROM match_predictions
      GROUP BY prediction_id
    )
    SELECT
      u.id as user_id,
      u.username,
      u.display_name,
      COUNT(DISTINCT p.pool_id) as pools_count,
      SUM(p.total_score) as total_score,
      SUM(
        COALESCE((SELECT COUNT(*) FROM group_predictions WHERE prediction_id = p.id AND points_earned > 0), 0) +
        COALESCE((SELECT COUNT(*) FROM bracket_predictions WHERE prediction_id = p.id AND points_earned > 0), 0)
      ) as total_correct,
      COALESCE(SUM(eh.exact_score_hits), 0) as exact_score_hits
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN tiebreaker_close tc ON tc.prediction_id = p.id
    LEFT JOIN exact_hits eh ON eh.prediction_id = p.id
    GROUP BY u.id
    ORDER BY total_score DESC, exact_score_hits DESC, total_correct DESC, tc.closeness ASC
    LIMIT 100
  `).all() as any[];

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

  return { leaderboard, currentUserId };
};
