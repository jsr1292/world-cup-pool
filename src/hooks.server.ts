import { redirect, type Handle } from '@sveltejs/kit';
import { cleanSessions, getSessionUser } from '$lib/server/queries.js';
import { getCachedSession, setCachedSession } from '$lib/server/cache.js';
import { startSyncScheduler } from '$lib/server/sync-runner.js';
import { startNotificationScheduler } from '$lib/server/notifications.js';

// Background workers, started once per server process. Each is a no-op unless
// its prerequisites are configured (a live-score provider / SMTP).
startSyncScheduler();
startNotificationScheduler();

// §4.5 — `/api/auth` matches /api/auth/login, /register, /logout
// AND /api/auth/change-password. The change-password handler self-guards
// (it requires `locals.user` and would return 401), so this is not a
// security hole — just a documentation note. If a future route under
// /api/auth/* assumes the publicPaths prefix means "unauthenticated", add
// an explicit auth check.
const publicPaths = new Set(['/login', '/register', '/forgot', '/reset', '/verify-email', '/api/health']);
const publicPathPrefixes = [
	'/api/auth/login',
	'/api/auth/register',
	'/api/auth/logout',
	'/api/auth/forgot',
	'/api/auth/reset',
	'/join',
	'/s/',
];
let _lastClean = 0;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;

  // §3.4 — Defence-in-depth: reject cross-origin state-changing API requests.
  // sameSite=lax already blocks the cookie cross-site, but if that policy is
  // ever relaxed (e.g. for an OAuth flow), this guards the JSON endpoints.
  if (path.startsWith('/api/') && STATE_CHANGING.has(event.request.method)) {
    const origin = event.request.headers.get('origin');
    if (origin) {
      // Normalize both sides: strip common LAN host variants so that
      // http://localhost:3000, http://127.0.0.1:3000, http://0.0.0.0:3000
      // and http://<lan-ip>:3000 all match each other.
      const normalize = (u: string): string => {
        try {
          const url = new URL(u);
          // Collapse loopback variants so dev still works regardless of which
          // bind address the browser sees. Force http so both sides agree.
          if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) {
            url.hostname = 'localhost';
            url.protocol = 'http:';
          }
          // Also collapse private LAN IPs to localhost so that accessing via
          // http://192.168.x.x:3000 from another machine on the same network
          // doesn't trigger a cross-origin rejection.
          // §1.12 — Only in non-production. In prod the app may sit behind a
          // reverse proxy whose IP looks like a 10.x.x.x address; without this
          // gate, an Origin spoofed to a private IP would bypass the check.
          if (process.env.NODE_ENV !== 'production') {
            const parts = url.hostname.split('.');
            if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
              const octets = parts.map(Number);
              if (octets[0] === 10 ||
                  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
                  (octets[0] === 192 && octets[1] === 168)) {
                url.hostname = 'localhost';
                url.protocol = 'http:';
              }
            }
          }
          return url.origin; // scheme + hostname + port — full comparison
        } catch {
          return u;
        }
      };
      const normOrigin = normalize(origin);
      const normExpected = normalize(event.url.origin);
      // Same-origin guarantee: the browser's Origin host equals the Host it
      // actually connected to. Accept that directly — it's robust to how the
      // server derives event.url.origin behind HA ingress / a direct port
      // mapping (where a missing x-forwarded-host would otherwise make the
      // comparison fail for direct LAN/IP access). A cross-site attacker's
      // Origin host never equals our Host, so CSRF protection is unchanged.
      let sameHost = false;
      try {
        const reqHost = event.request.headers.get('host');
        sameHost = !!reqHost && new URL(origin).host === reqHost;
      } catch { /* malformed Origin → fall through to the strict check */ }
      if (normOrigin !== normExpected && !sameHost) {
        return new Response(JSON.stringify({ error: 'Origin no permitido' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    // If origin is null (e.g. same-origin form submit, server-to-server),
    // SvelteKit's built-in CSRF still applies to form actions; JSON endpoints
    // are protected by sameSite cookies. We deliberately don't require Origin.
  }

  if (token) {
    let user = getCachedSession(token);
    if (!user) {
      try {
        // getSessionUser hashes the raw cookie token before the DB lookup.
        // The in-process cache stays keyed by the raw token (never persisted).
        user = await getSessionUser(token);
        if (user) setCachedSession(token, user);
      } catch (e) {
        console.error('[hooks] DB error during session lookup:', e);
        // Continue without user — authenticated routes will redirect to /login
        user = null;
      }
    }

    if (user) {
      event.locals.user = user;
    }
  }

  // §3.1 — Run cleanSessions at most once per minute, regardless of cache
  // hit/miss. Previously gated on "no user found", which means a healthy
  // request stream never cleans up expired sessions.
  const now = Date.now();
  if (now - _lastClean > 60_000) {
    _lastClean = now;
    cleanSessions().catch(console.error);
  }

  // B1-2: Si el usuario ya está autenticado y visita /login, redirigir al inicio
  if (event.locals.user && path === '/login') {
    throw redirect(302, '/');
  }

  if (publicPaths.has(path) || publicPathPrefixes.some(p => path.startsWith(p))) return resolve(event);
  if (path.startsWith('/_app') || path.includes('.')) return resolve(event);
  if (!event.locals.user) {
    if (event.url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw redirect(302, '/login');
  }

  return resolve(event);
};
