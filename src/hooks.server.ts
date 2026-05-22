import { redirect, type Handle } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';
import { cleanSessions } from '$lib/server/queries.js';
import { getCachedSession, setCachedSession } from '$lib/server/cache.js';

const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join', '/s/'];
let _lastClean = 0;

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;

  if (token) {
    let user = getCachedSession(token);
    if (!user) {
      const { rows } = await query(
        "SELECT u.id, u.username, u.display_name, u.is_admin FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1 AND s.expires_at > NOW()",
        [token]
      );
      user = rows[0] as any;
      if (user) setCachedSession(token, user);
    }

    if (user) {
      event.locals.user = user;
    } else {
      const now = Date.now();
      if (now - _lastClean > 60_000) { _lastClean = now; await cleanSessions(); }
    }
  }

  if (publicPaths.some(p => path.startsWith(p))) return resolve(event);
  if (path.startsWith('/_app') || path.includes('.')) return resolve(event);
  if (!event.locals.user) throw redirect(302, '/login');

  return resolve(event);
};
