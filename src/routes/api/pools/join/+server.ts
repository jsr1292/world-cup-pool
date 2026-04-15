import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Login required' }, { status: 401 });

  const { code } = await request.json();
  if (!code) return json({ error: 'Code required' }, { status: 400 });

  const pool = getPoolByInvite(code);
  if (!pool) return json({ error: 'Invalid invite code' }, { status: 404 });

  const joined = joinPool(pool.id, locals.user.id);
  if (!joined) return json({ error: 'Already in this pool' }, { status: 409 });

  return json({ pool_id: pool.id });
};
