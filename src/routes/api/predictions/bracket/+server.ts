import { db } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

const VALID_PHASES = new Set(['r32', 'r16', 'qf', 'sf', 'final', '3rd']);

// GET /api/predictions/bracket?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const predictionId = Number(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Missing prediction_id' }, { status: 400 });

  // Verify ownership
  const pred = db.prepare('SELECT user_id FROM predictions WHERE id = ?').get(predictionId) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'Not your prediction' }, { status: 403 });
  }

  const rows = db.prepare(`
    SELECT phase, slot, team_id FROM bracket_predictions
    WHERE prediction_id = ?
    ORDER BY phase, slot
  `).all(predictionId) as any[];

  const result: Record<string, Record<number, number>> = {};
  for (const row of rows) {
    if (!result[row.phase]) result[row.phase] = {};
    result[row.phase][row.slot] = row.team_id;
  }

  return json(result);
};

// POST /api/predictions/bracket
// Body: { prediction_id, picks: { r32: { 1: teamId, ... }, r16: {...}, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { prediction_id, picks } = body as {
    prediction_id: number;
    picks: Record<string, Record<number, number | null>>;
  };

  if (!prediction_id || !picks) {
    return json({ error: 'Missing prediction_id or picks' }, { status: 400 });
  }

  // Verify ownership
  const pred = db.prepare('SELECT user_id FROM predictions WHERE id = ?').get(prediction_id) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'Not your prediction' }, { status: 403 });
  }

  // Validate phases
  for (const phase of Object.keys(picks)) {
    if (!VALID_PHASES.has(phase)) {
      return json({ error: `Invalid phase: ${phase}` }, { status: 400 });
    }
  }

  // Max slots per phase: r32=32, r16=16, qf=8, sf=4, final=2, 3rd=2
  const MAX_SLOTS: Record<string, number> = {
    r32: 32, r16: 16, qf: 8, sf: 4, final: 2, '3rd': 2,
  };

  for (const [phase, slots] of Object.entries(picks)) {
    const max = MAX_SLOTS[phase] ?? 0;
    for (const [slotStr, teamId] of Object.entries(slots)) {
      const slot = Number(slotStr);
      if (slot < 1 || slot > max) {
        return json({ error: `Invalid slot ${slot} for phase ${phase}` }, { status: 400 });
      }
      if (teamId !== null) {
        // Validate team exists
        const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
        if (!team) {
          return json({ error: `Invalid team_id: ${teamId}` }, { status: 400 });
        }
      }
    }
  }

  const upsert = db.prepare(`
    INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id)
    VALUES (@prediction_id, @phase, @slot, @team_id)
    ON CONFLICT(prediction_id, phase, slot) DO UPDATE SET team_id = @team_id
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM bracket_predictions WHERE prediction_id = ? AND phase = ? AND slot = ?
  `);

  const saveAll = db.transaction(() => {
    for (const [phase, slots] of Object.entries(picks)) {
      for (const [slotStr, teamId] of Object.entries(slots)) {
        const slot = Number(slotStr);
        if (teamId === null) {
          // Null means clear the slot
          deleteStmt.run(prediction_id, phase, slot);
        } else {
          upsert.run({ prediction_id, phase, slot, team_id: teamId });
        }
      }
    }
  });

  try {
    saveAll();
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Save failed' }, { status: 500 });
  }
};
