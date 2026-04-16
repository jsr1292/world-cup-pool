import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  // Get top 50 scorers across all pools
  const rows = db.prepare(`
    SELECT 
      u.id as user_id,
      u.username,
      u.display_name,
      COUNT(DISTINCT p.pool_id) as pools_count,
      SUM(p.total_score) as total_score,
      SUM(
        COALESCE((SELECT COUNT(*) FROM group_predictions WHERE prediction_id = p.id AND points_earned > 0), 0) +
        COALESCE((SELECT COUNT(*) FROM bracket_predictions WHERE prediction_id = p.id AND points_earned > 0), 0)
      ) as total_correct
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    GROUP BY u.id
    ORDER BY total_score DESC, total_correct DESC
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
  }));

  return { leaderboard };
};
