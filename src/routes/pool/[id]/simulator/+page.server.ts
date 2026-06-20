import { getSimulatorData } from '$lib/server/simulator-data.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');
  const res = await getSimulatorData(Number(params.id), locals.user.id);
  if ('error' in res) throw error(res.status, res.error as string);
  return res as any;
};
