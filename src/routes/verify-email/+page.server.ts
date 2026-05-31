import { consumeEmailVerificationToken, createSession } from '$lib/server/queries.js';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ url, cookies }) => {
  const token = url.searchParams.get('token');
  if (!token) return { ok: false };

  const userId = await consumeEmailVerificationToken(token);
  if (!userId) return { ok: false };

  // Verified — log them in and send them to the app.
  const session = await createSession(userId);
  cookies.set('session', session, {
    path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true,
    sameSite: 'lax', secure: process.env.NODE_ENV !== 'development',
  });
  throw redirect(303, '/');
};
