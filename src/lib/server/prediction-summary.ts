/**
 * Build a human-readable summary of a single prediction entry (group standings
 * + knockout picks), used by the confirmation email (user-initiated and the
 * automatic "you're locked in" notifier).
 */
import { query } from './db.js';

export interface PredictionSummary {
  predictionId: number;
  poolName: string;
  label: string;
  displayName: string;
  email: string | null;
  groups: { group: string; teams: { pos: number; name: string; flag: string }[] }[];
  bracket: { phase: string; phaseLabel: string; teams: { name: string; flag: string }[] }[];
}

const PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];
const PHASE_LABELS: Record<string, string> = {
  r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', '3rd': '3.º puesto', final: 'Final',
};

function flagEmoji(code: string): string {
  if (!code) return '';
  return code.toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Gather a prediction's picks into a render-ready structure. null if missing. */
export async function buildPredictionSummary(predictionId: number): Promise<PredictionSummary | null> {
  const { rows: meta } = await query(
    `SELECT p.id, p.label, po.name AS pool_name, u.display_name, u.email
     FROM predictions p
     JOIN pools po ON po.id = p.pool_id
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [predictionId]
  );
  if (meta.length === 0) return null;
  const m = meta[0];

  const { rows: teamRows } = await query('SELECT id, name, flag_code FROM teams');
  const team = new Map<number, { name: string; flag: string }>();
  for (const t of teamRows) team.set(t.id, { name: t.name, flag: flagEmoji(t.flag_code) });
  const nameOf = (id: number | null) => (id && team.get(id)) || { name: 'TBD', flag: '' };

  const { rows: gp } = await query(
    `SELECT group_name, position_1, position_2, position_3, position_4
     FROM group_predictions WHERE prediction_id = $1 ORDER BY group_name`,
    [predictionId]
  );
  const groups = gp.map(g => ({
    group: g.group_name,
    teams: [g.position_1, g.position_2, g.position_3, g.position_4]
      .map((id, i) => ({ pos: i + 1, ...nameOf(id) }))
      .filter(t => t.name !== 'TBD'),
  })).filter(g => g.teams.length > 0);

  const { rows: bp } = await query(
    `SELECT phase, team_id FROM bracket_predictions WHERE prediction_id = $1`,
    [predictionId]
  );
  const byPhase = new Map<string, { name: string; flag: string }[]>();
  for (const b of bp) {
    if (!b.team_id) continue;
    if (!byPhase.has(b.phase)) byPhase.set(b.phase, []);
    byPhase.get(b.phase)!.push(nameOf(b.team_id));
  }
  const bracket = PHASE_ORDER
    .filter(ph => byPhase.has(ph))
    .map(ph => ({ phase: ph, phaseLabel: PHASE_LABELS[ph] ?? ph, teams: byPhase.get(ph)! }));

  return {
    predictionId,
    poolName: m.pool_name,
    label: m.label || 'Entrada principal',
    displayName: m.display_name,
    email: m.email ?? null,
    groups,
    bracket,
  };
}
