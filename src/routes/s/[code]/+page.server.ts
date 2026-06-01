import { query } from '$lib/server/db.js';
import { getPoolByShareToken, getPoolLeaderboard } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';
import { getCachedPoolLeaderboard, setCachedPoolLeaderboard } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	// B3-2: Use share_token (not invite_code) so public URL cannot be used to join
	const pool = await getPoolByShareToken(params.code);
	if (!pool) throw error(404, 'Quiniela no encontrada');

	const cached = getCachedPoolLeaderboard(pool.id);
	if (cached) return cached;

	const leaderboard = await getPoolLeaderboard(pool.id);

	// Get the actual final match score for tiebreaker closeness (matches pool/[id] enrichment)
	const { rows: fmRows } = await query(`
		SELECT home_score, away_score FROM matches
		WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
		LIMIT 1
	`);
	const finalMatch = fmRows[0] ?? null;

	const predIds = leaderboard.map((e: any) => e.id);
	let groupCorrectMap: Record<number, number> = {};
	let bracketByPredPhase: Record<number, Record<string, number>> = {};
	let tiebreakerMap: Record<number, any> = {};
	let exactHitsMap: Record<number, number> = {};

	if (predIds.length > 0) {
		// True exact-scoreline hits — same tiebreaker the in-app pool view and the
		// global leaderboard use, so the public scoreboard orders ties identically.
		const { rows: ehRows } = await query(`
			SELECT mp.prediction_id, COUNT(*) AS cnt
			FROM match_predictions mp
			JOIN matches m ON m.id = mp.match_id
				AND m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
			WHERE mp.prediction_id = ANY($1::int[])
				AND mp.home_score = m.home_score AND mp.away_score = m.away_score
			GROUP BY mp.prediction_id
		`, [predIds]);
		ehRows.forEach((r: any) => { exactHitsMap[r.prediction_id] = Number(r.cnt); });

		// Use ANY($1::int[]) — same pattern as pool/[id]/+page.server.ts
		const { rows: gcRows } = await query(`
			SELECT prediction_id, COUNT(*) as cnt
			FROM group_predictions
			WHERE prediction_id = ANY($1::int[]) AND points_earned > 0
			GROUP BY prediction_id
		`, [predIds]);
		gcRows.forEach((r: any) => { groupCorrectMap[r.prediction_id] = Number(r.cnt); });

		const { rows: brRows } = await query(`
			SELECT prediction_id, phase, points_earned
			FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
		`, [predIds]);
		brRows.forEach((br: any) => {
			if (br.points_earned > 0) {
				if (!bracketByPredPhase[br.prediction_id]) bracketByPredPhase[br.prediction_id] = {};
				bracketByPredPhase[br.prediction_id][br.phase] = (bracketByPredPhase[br.prediction_id][br.phase] || 0) + 1;
			}
		});

		const { rows: tbRows } = await query(`
			SELECT prediction_id, home_score, away_score
			FROM tiebreaker WHERE prediction_id = ANY($1::int[])
		`, [predIds]);
		tbRows.forEach((tb: any) => { tiebreakerMap[tb.prediction_id] = tb; });
	}

	const enriched = leaderboard.map((entry: any) => {
		const predId = entry.id;
		const groupCorrect = groupCorrectMap[predId] ?? 0;
		const bracketByPhase = bracketByPredPhase[predId] ?? {};
		let tiebreakerClose = 9999;
		if (finalMatch) {
			const tb = tiebreakerMap[predId];
			if (tb?.home_score != null && tb?.away_score != null) {
				tiebreakerClose = Math.abs(tb.home_score - finalMatch.home_score) + Math.abs(tb.away_score - finalMatch.away_score);
			}
		}
		return {
			...entry,
			group_correct: groupCorrect,
			bracket_correct: bracketByPhase,
			total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
			exact_score_hits: exactHitsMap[predId] ?? 0,
			tiebreaker_close: tiebreakerClose,
		};
	});

	// Identical sort criteria to pool/[id]/+page.server.ts and the global
	// leaderboard, so a shared scoreboard orders ties the same as the in-app view:
	// total_score DESC → exact_score_hits DESC → total_correct DESC →
	// tiebreaker_close ASC → updated_at ASC.
	enriched.sort((a: any, b: any) =>
		b.total_score - a.total_score ||
		b.exact_score_hits - a.exact_score_hits ||
		b.total_correct - a.total_correct ||
		a.tiebreaker_close - b.tiebreaker_close ||
		new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
	);

	const { rows: mcRows } = await query('SELECT COUNT(*) as cnt FROM pool_members WHERE pool_id = $1', [pool.id]);
	const memberCount = mcRows[0];

	const result = {
		pool: { id: pool.id, name: pool.name, buy_in: pool.buy_in },
		leaderboard: enriched,
		memberCount: memberCount.cnt,
	};
	setCachedPoolLeaderboard(pool.id, result);
	return result;
};
