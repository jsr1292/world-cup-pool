import { getUserPools } from '$lib/server/queries.js';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { WORLD_CUP_KICKOFF } from '$lib/constants.js';

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user?.id;
  const pools = userId ? await getUserPools(userId) : [];

  // If the user is in exactly one pool, open straight into it — unless `?h=1`
  // is present (the "Inicio" nav link uses it to force the home/create/join
  // screen, so single-pool users aren't trapped out of it).
  if (pools.length === 1 && url.searchParams.get('h') !== '1') {
    throw redirect(307, `/pool/${(pools[0] as any).id}`);
  }

  // Days until World Cup 2026 kick-off (June 11, 2026)
  const kickoff = WORLD_CUP_KICKOFF;
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((kickoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return { pools, daysUntil };
};
