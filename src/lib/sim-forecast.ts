// Build a group-stage sim from a member's own predictions (their "forecast").
export interface ForecastMember {
  groupPicks: Record<number, '1' | 'X' | '2'>;
  bracketPicks: { phase: string; slot: number; teamId: number | null }[];
}

export function buildForecastSim(
  member: ForecastMember,
  ctx: { unplayedGroupMatchIds: number[] }
): { sim: Record<number, '1' | 'X' | '2'> } {
  const sim: Record<number, '1' | 'X' | '2'> = {};
  for (const mid of ctx.unplayedGroupMatchIds) {
    const p = member.groupPicks[mid];
    if (p) sim[mid] = p;
  }
  return { sim };
}
