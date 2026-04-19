import { db } from '$lib/server/db.js';
import { getPoolById, getPoolLeaderboard, getScoringConfig } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  const pool = db.prepare('SELECT * FROM pools WHERE invite_code = ?').get(params.code) as any;
  if (!pool) throw new Error('Quiniela no encontrada');

  const leaderboard = getPoolLeaderboard(pool.id);

  // Enrich with correct pick counts
  const enriched = leaderboard.map((entry: any) => {
    const groupCorrect = (db.prepare(`
      SELECT COUNT(*) as cnt FROM group_predictions WHERE prediction_id = ? AND points_earned > 0
    `).get(entry.id) as any).cnt;

    const bracketByPhase: Record<string, number> = {};
    const bracketRows = db.prepare(`
      SELECT phase, points_earned FROM bracket_predictions WHERE prediction_id = ?
    `).all(entry.id) as any[];
    for (const br of bracketRows) {
      if (br.points_earned > 0) {
        bracketByPhase[br.phase] = (bracketByPhase[br.phase] || 0) + 1;
      }
    }

    return {
      ...entry,
      group_correct: groupCorrect,
      bracket_correct: bracketByPhase,
      total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
    };
  });

  enriched.sort((a: any, b: any) => b.total_score - a.total_score || b.total_correct - a.total_correct);

  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM pool_members WHERE pool_id = ?').get(pool.id) as any;

  return {
    pool: { id: pool.id, name: pool.name, buy_in: pool.buy_in },
    leaderboard: enriched,
    memberCount: memberCount.cnt,
  };
};
