import { getUserPools } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  const pools = userId ? await getUserPools(userId) : [];

  // Days until World Cup 2026 kick-off (June 11, 2026)
  const kickoff = new Date('2026-06-11T17:00:00Z');
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((kickoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return { pools, daysUntil };
};
