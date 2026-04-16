import { createPool } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { name, buy_in = 0, allow_multiple = false } = body;

  if (!name?.trim()) return json({ error: 'Name required' }, { status: 400 });

  const result = createPool(name.trim(), locals.user.id, buy_in, allow_multiple ? 1 : 0);
  return json({ id: Number(result.id), invite_code: result.inviteCode });
};
