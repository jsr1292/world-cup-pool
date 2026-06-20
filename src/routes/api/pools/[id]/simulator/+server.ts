import { json, type RequestHandler } from '@sveltejs/kit';
import { getSimulatorData } from '$lib/server/simulator-data.js';

// GET /api/pools/[id]/simulator — same data as the simulator page loader, so the
// inline "Simulador" tab can lazy-fetch it instead of navigating to a route.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const res = await getSimulatorData(Number(params.id), locals.user.id);
  if ('error' in res) return json({ error: res.error }, { status: res.status as number });
  return json(res);
};
