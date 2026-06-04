import type { PageServerLoad } from './$types.js';
import { MAX_USERNAME_CHANGES, usernameChangesUsed } from '$lib/server/username.js';

export const load: PageServerLoad = async ({ locals }) => {
  const used = locals.user ? await usernameChangesUsed(locals.user.id) : 0;
  return {
    user: locals.user,
    usernameChangesUsed: used,
    usernameChangesMax: MAX_USERNAME_CHANGES,
  };
};
