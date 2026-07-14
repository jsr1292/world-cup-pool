import { json, type RequestHandler } from '@sveltejs/kit';
import { getSimulatorData } from '$lib/server/simulator-data.js';

// GET /api/pools/[id]/stakes — just the "qué se juega" certainties (champions /
// decisive games), reusing the cached simulator payload so the enumeration runs
// at most once per minute per pool no matter how many people are watching.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const res = await getSimulatorData(Number(params.id), locals.user.id);
  if ('error' in res) return json({ error: res.error }, { status: res.status as number });
  return json({ stakes: (res as Record<string, any>).stakes ?? null });
};
