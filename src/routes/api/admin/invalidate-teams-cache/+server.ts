import { invalidateTeamsCache } from '$lib/server/cache.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	invalidateTeamsCache();
	return json({ ok: true });
};
