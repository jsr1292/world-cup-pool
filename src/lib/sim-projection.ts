// Pure unified projection: compose simulated GROUP points and simulated KNOCKOUT
// points into one ranked leaderboard, with no double-counting. Framework-free.
import { scoreEntry, type PreppedEntry, type ResolvedTree } from './knockout-odds.js';

export interface UnifiedEntry {
  id: number;
  userId: number;
  name: string;
  label: string | null;
  live: number;                                  // entry's current live total_score
  prepped: PreppedEntry;                         // prepEntry(bracketEntry) — prepped.in.base = total_score − realizedKO
  groupPicks: Record<number, '1' | 'X' | '2'>;   // this member's group pick per matchId
  groupOrders: Record<string, number[]>;         // this member's predicted [p1,p2,p3,p4] per group
}

export interface ProjCtx {
  sim: Record<number, '1' | 'X' | '2'>;          // simulated group results (matchId → code)
  unplayedByGroup: Record<string, { id: number }[]>; // undecided group matches per group
  simOrderByGroup: Record<string, number[]>;     // groups the sim FULLY completes → resulting order
  matchOutcomePts: number;
  groupPositionPts: number;
  baseRankById: Record<number, number>;          // live dense rank per entry id (for movement)
}

export interface UnifiedRow {
  id: number; userId: number; name: string; label: string | null;
  base: number; live: number; total: number; correct: number; rank: number; move: number;
}

/** Points/correct a member earns from the SIMULATED (undecided) group items only.
 *  Finished group matches are already baked into total_score (→ prepped.in.base). */
function groupSim(e: UnifiedEntry, ctx: ProjCtx): { pts: number; correct: number } {
  let pts = 0, correct = 0;
  for (const g of Object.keys(ctx.unplayedByGroup)) {
    for (const m of ctx.unplayedByGroup[g]) {
      const code = ctx.sim[m.id];
      if (code && e.groupPicks[m.id] === code) { pts += ctx.matchOutcomePts; correct++; }
    }
  }
  if (ctx.groupPositionPts > 0) {
    for (const g of Object.keys(ctx.simOrderByGroup)) {
      const order = ctx.simOrderByGroup[g], pred = e.groupOrders[g];
      if (!pred) continue;
      for (let i = 0; i < 4; i++) if (pred[i] && order[i] === pred[i]) { pts += ctx.groupPositionPts; correct++; }
    }
  }
  return { pts, correct };
}

export function computeUnifiedProjection(
  entries: UnifiedEntry[],
  tree: ResolvedTree,
  koRules: Record<string, number>,
  ctx: ProjCtx
): UnifiedRow[] {
  const rows = entries.map((e) => {
    const ko = scoreEntry(e.prepped, tree, koRules);   // = base + simulated KO
    const gs = groupSim(e, ctx);
    return {
      id: e.id, userId: e.userId, name: e.name, label: e.label,
      base: e.prepped.in.base,
      live: e.live,
      total: ko.pts + gs.pts,
      correct: ko.correct + gs.correct,
    };
  });
  rows.sort((a, b) => b.total - a.total || b.correct - a.correct || b.live - a.live);
  // Dense ranking by POINTS only (1-2-2-3), matching the app's Clasificación
  // (leaderboardRanks): entries level on points SHARE a position. Aciertos is
  // NOT a position tiebreak — it only orders display within a tie.
  let r = 0, prevT: number | null = null;
  return rows.map((row) => {
    if (prevT === null || row.total !== prevT) { r += 1; prevT = row.total; }
    return { ...row, rank: r, move: (ctx.baseRankById[row.id] ?? r) - r };
  });
}
