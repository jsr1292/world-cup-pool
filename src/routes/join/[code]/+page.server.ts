import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const code = params.code.toUpperCase();
  // Preserve the join intent through login/registration so the user lands back
  // here (and auto-joins) instead of on the home page having to re-click the
  // invite link.
  if (!locals.user) {
    throw redirect(303, `/login?redirect=${encodeURIComponent('/join/' + code)}`);
  }
  return { code };
};
