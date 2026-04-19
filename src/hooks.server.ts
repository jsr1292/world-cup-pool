import { redirect, type Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';

const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join', '/s/'];

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;

  // Resolve session for ALL paths (including public)
  if (token) {
    const user = db.prepare(
      'SELECT u.id, u.username, u.display_name, u.is_admin FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime(\'now\')'
    ).get(token) as any;

    if (user) {
      event.locals.user = user;
    }
  }

  // Allow public paths (no auth required)
  if (publicPaths.some(p => path.startsWith(p))) {
    return resolve(event);
  }

  // Allow static assets
  if (path.startsWith('/_app') || path.includes('.')) {
    return resolve(event);
  }

  // Require auth for everything else
  if (!event.locals.user) {
    throw redirect(302, '/login');
  }

  return resolve(event);
};
