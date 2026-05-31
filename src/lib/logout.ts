/**
 * Log out via a JSON fetch instead of an HTML form post.
 *
 * A plain <form method="POST"> triggers SvelteKit's built-in same-origin CSRF
 * check, which compares the FULL origin (scheme+host+port). Behind HA ingress
 * or on direct LAN-HTTP access, adapter-node can derive a different scheme than
 * the browser's Origin header (e.g. https vs http), so the form post is
 * rejected with "Cross-site POST form submissions are forbidden".
 *
 * A fetch POST to /api/auth/logout instead goes through hooks.server.ts, which
 * validates by HOST (robust to scheme/proxy differences) — the same path every
 * other state-changing request already uses. We navigate regardless of the
 * result so the user always ends up at /login.
 */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore network errors — redirect anyway */
  }
  window.location.href = '/login';
}
