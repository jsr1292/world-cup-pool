import type { PageServerLoad } from './$types.js';
import { MAX_DISPLAY_NAME_CHANGES, displayNameChangesUsed } from '$lib/server/display-name.js';

export const load: PageServerLoad = async ({ locals }) => {
  const used = locals.user ? await displayNameChangesUsed(locals.user.id) : 0;
  return {
    user: locals.user,
    displayNameChangesUsed: used,
    displayNameChangesMax: MAX_DISPLAY_NAME_CHANGES,
  };
};
