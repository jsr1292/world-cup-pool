import { db } from '$lib/server/db.js';
import { getPoolLeaderboard, getScoringConfig } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';
import { getCachedPoolLeaderboard, setCachedPoolLeaderboard } from '$lib/server/cache.js';

export const load: PageServerLoad = async ({ params }) => {
  const pool = db.prepare('SELECT * FROM pools WHERE invite_code = ?').get(params.code) as any;
  if (!pool) throw new Error('Quiniela no encontrada');

  const cached = getCachedPoolLeaderboard(pool.id);
  if (cached) return cached;

  const leaderboard = getPoolLeaderboard(pool.id);

  // F-19: Bulk-fetch enrichment data to eliminate N+1 queries
  const predIds = leaderboard.map((e: any) => e.id);
  let groupCorrectMap: Record<number, number> = {};
  let bracketByPredPhase: Record<number, Record<string, number>> = {};

  if (predIds.length > 0) {
    const ph = predIds.map(() => '?').join(',');

    (db.prepare(`
      SELECT prediction_id, COUNT(*) as cnt
      FROM group_predictions
      WHERE prediction_id IN (${ph}) AND points_earned > 0
      GROUP BY prediction_id
    `).all(...predIds) as any[]).forEach(r => { groupCorrectMap[r.prediction_id] = r.cnt; });

    (db.prepare(`
      SELECT prediction_id, phase, points_earned
      FROM bracket_predictions WHERE prediction_id IN (${ph})
    `).all(...predIds) as any[]).forEach(br => {
      if (br.points_earned > 0) {
        if (!bracketByPredPhase[br.prediction_id]) bracketByPredPhase[br.prediction_id] = {};
        bracketByPredPhase[br.prediction_id][br.phase] = (bracketByPredPhase[br.prediction_id][br.phase] || 0) + 1;
      }
    });
  }

  const enriched = leaderboard.map((entry: any) => {
    const predId = entry.id;
    const groupCorrect = groupCorrectMap[predId] ?? 0;
    const bracketByPhase = bracketByPredPhase[predId] ?? {};
    return {
      ...entry,
      group_correct: groupCorrect,
      bracket_correct: bracketByPhase,
      total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
    };
  });

  enriched.sort((a: any, b: any) => b.total_score - a.total_score || b.total_correct - a.total_correct);

  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM pool_members WHERE pool_id = ?').get(pool.id) as any;

  const result = {
    pool: { id: pool.id, name: pool.name, buy_in: pool.buy_in },
    leaderboard: enriched,
    memberCount: memberCount.cnt,
  };
  setCachedPoolLeaderboard(pool.id, result);
  return result;
};
