// Shared FIFA World Cup 2026 group-ranking logic.
//
// This is the SINGLE source of truth for how a group table is ordered, used by:
//   • the scoring engine (src/lib/server/scoring.ts) to rank the ACTUAL table
//     from finished match results, and
//   • the predict page + match-scores endpoint to derive a player's PREDICTED
//     table from the scorelines they entered.
//
// Keeping both on the exact same function guarantees the live preview a player
// sees, the standings written to the bracket, and the table they're scored
// against can never disagree. The module is intentionally pure (no DB, no
// framework) so it runs identically on the client and the server.

export interface GsMatch {
	homeTeamId: number;
	awayTeamId: number;
	homeScore: number;
	awayScore: number;
}

// §2.3 — FIFA World Cup group ranking (regulations art. on ranking):
//   1. points (all group matches)
//   2. overall goal difference
//   3. overall goals scored
//   — if two+ teams are still equal on 1–3, apply head-to-head among ONLY
//     those teams:
//   4. H2H points  5. H2H goal difference  6. H2H goals scored
//   — then fair play / drawing of lots. We don't track fair-play points, so the
//     final fallback is a deterministic order by team id (ascending, stable).
//
// NOTE: overall GD/GF come BEFORE head-to-head. This is the FIFA World Cup
// procedure and differs from UEFA (which applies head-to-head first).
//
// `matches` should contain ONLY the matches that actually have a result (for a
// predicted table: only the scorelines the user entered). Teams are discovered
// from the matches, so a partial group ranks just the teams that have played;
// the caller pads the remaining positions with null.
export function rankGroup(matches: GsMatch[], preferredOrder?: number[]): number[] {
	// Overall per-team aggregate (points / goals for / goals against).
	const teams: Record<number, { points: number; gf: number; ga: number }> = {};
	function ensure(id: number) {
		if (!teams[id]) teams[id] = { points: 0, gf: 0, ga: 0 };
		return teams[id];
	}
	for (const m of matches) {
		const h = ensure(m.homeTeamId);
		const a = ensure(m.awayTeamId);
		h.gf += m.homeScore; h.ga += m.awayScore;
		a.gf += m.awayScore; a.ga += m.homeScore;
		if (m.homeScore > m.awayScore) h.points += 3;
		else if (m.homeScore < m.awayScore) a.points += 3;
		else { h.points += 1; a.points += 1; }
	}

	const ids = Object.keys(teams).map(Number);

	// Manual-tiebreak mode: a caller-supplied order decides among teams LEVEL ON
	// POINTS, overriding GD/GF/head-to-head (the player's explicit choice). Points
	// remain the hard constraint — a team can never outrank one with more points.
	// Teams absent from preferredOrder fall to the end of their points group by id.
	// (Used only for the PREDICTED table; the ACTUAL table passes no preferredOrder
	// and keeps the strict FIFA chain below.)
	if (preferredOrder && preferredOrder.length) {
		const idx = new Map(preferredOrder.map((id, i) => [id, i] as const));
		return ids.slice().sort((a, b) =>
			(teams[b].points - teams[a].points) ||
			((idx.get(a) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b) ?? Number.MAX_SAFE_INTEGER)) ||
			(a - b)
		);
	}

	// Head-to-head stats among an exact subset of teams (only matches BETWEEN
	// those teams count).
	function h2hStats(subset: Set<number>): Map<number, { points: number; gf: number; ga: number }> {
		const out = new Map<number, { points: number; gf: number; ga: number }>();
		for (const id of subset) out.set(id, { points: 0, gf: 0, ga: 0 });
		for (const m of matches) {
			if (!subset.has(m.homeTeamId) || !subset.has(m.awayTeamId)) continue;
			const h = out.get(m.homeTeamId)!;
			const a = out.get(m.awayTeamId)!;
			h.gf += m.homeScore; h.ga += m.awayScore;
			a.gf += m.awayScore; a.ga += m.homeScore;
			if (m.homeScore > m.awayScore) h.points += 3;
			else if (m.homeScore < m.awayScore) a.points += 3;
			else { h.points += 1; a.points += 1; }
		}
		return out;
	}

	// Step 1 — sort by overall points, then overall GD, then overall GF.
	const arr = ids.map(id => ({
		id,
		points: teams[id].points,
		gf: teams[id].gf,
		gd: teams[id].gf - teams[id].ga,
	}));
	arr.sort((a, b) =>
		(b.points - a.points) || (b.gd - a.gd) || (b.gf - a.gf)
	);

	// Step 2 — break remaining ties (teams equal on points AND GD AND GF) by
	// head-to-head among exactly those teams, then by id as the final fallback.
	const finalOrder: number[] = [];
	let i = 0;
	while (i < arr.length) {
		let j = i + 1;
		while (
			j < arr.length &&
			arr[j].points === arr[i].points &&
			arr[j].gd === arr[i].gd &&
			arr[j].gf === arr[i].gf
		) j++;
		const tied = arr.slice(i, j);
		if (tied.length === 1) {
			finalOrder.push(tied[0].id);
		} else {
			const subset = new Set(tied.map(t => t.id));
			const h2h = h2hStats(subset);
			tied.sort((a, b) => {
				const ah = h2h.get(a.id)!;
				const bh = h2h.get(b.id)!;
				const ahGd = ah.gf - ah.ga;
				const bhGd = bh.gf - bh.ga;
				return (bh.points - ah.points) || (bhGd - ahGd) || (bh.gf - ah.gf) || (a.id - b.id);
			});
			for (const t of tied) finalOrder.push(t.id);
		}
		i = j;
	}
	return finalOrder;
}
