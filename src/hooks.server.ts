import { redirect, type Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';

const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join'];

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;

  // Allow public paths
  if (publicPaths.some(p => path.startsWith(p))) {
    return resolve(event);
  }

  // Allow static assets
  if (path.startsWith('/_app') || path.includes('.')) {
    return resolve(event);
  }

  // Check session
  if (token) {
    const user = db.prepare(
      'SELECT u.id, u.username, u.display_name, u.is_admin FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime("now")'
    ).get(token) as any;

    if (user) {
      event.locals.user = user;
      return resolve(event);
    }
  }

  // No valid session, redirect to login
  if (path !== '/login') {
    throw redirect(302, '/login');
  }

  return resolve(event);
};
