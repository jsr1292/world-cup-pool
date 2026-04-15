import { getUserPools } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const pools = getUserPools(locals.user.id);
  return { pools };
};
