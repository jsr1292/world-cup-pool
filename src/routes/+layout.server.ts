import { db } from '$lib/server/db.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user || null,
  };
};
