# FIX-PLAN-OPUS-6 — Copy-paste-ready fixes for AUDIT-OPUS-FULL-6

All snippets below use **TAB indentation** unless they sit inside files that
already use 2-space indentation (most existing files). Match the surrounding
file's indentation when applying. Error messages remain in Spanish where the
existing code is Spanish. All new catch blocks use `errCode()`.

---

## §0 — Shared helpers (apply these FIRST)

### §0.1 — `invalidateCachedSessionByUserId` in `src/lib/server/cache.ts`

Required by §1.1, §1.2, §1.3.

**Old code** (`src/lib/server/cache.ts:178-181`):
```ts
export function invalidateCachedSession(token: string): void {
	_sessionCache.delete(token);
}
```

**New code** (append the new export immediately after):
```ts
export function invalidateCachedSession(token: string): void {
	_sessionCache.delete(token);
}

// §1.1 — Invalidate every cached session row for a single user. Used by the
// reset-password / change-password / promote-demote paths so a privilege
// change (or forced logout) takes effect immediately rather than after the
// 60s TTL expires.
export function invalidateCachedSessionByUserId(userId: number): void {
	for (const [token, e] of _sessionCache) {
		if (e.data?.id === userId) _sessionCache.delete(token);
	}
}
```

### §0.2 — `parseJsonBody` helper in `src/lib/server/json-body.ts` (NEW FILE)

Required by §3.1 (and consumed by §1.9, §3.1 call sites).

```ts
import { json } from '@sveltejs/kit';

// §3.1 — One reusable JSON body parser. Returns either { ok: true, body } or
// a ready-to-return 400 Response with the standard Spanish error message.
export async function parseJsonBody(request: Request):
	Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
	try {
		const body = await request.json();
		return { ok: true, body };
	} catch {
		return {
			ok: false,
			response: json({ error: 'Cuerpo JSON inválido' }, { status: 400 }),
		};
	}
}
```

### §0.3 — Export `runWithConcurrency` from `src/lib/server/concurrency.ts` (NEW FILE)

Required by §2.6, §3.7. Currently the helper lives privately inside
`/api/admin/sync-scores/+server.ts`. Extract it so other admin endpoints can
reuse it without duplication.

```ts
// §2.6 — Bounded-concurrency worker pool, extracted from sync-scores so
// admin/results and admin/fifa-sync can share it.
export async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	const queue = items.slice();
	const runners: Promise<void>[] = [];
	for (let i = 0; i < Math.min(limit, queue.length); i++) {
		runners.push((async () => {
			while (queue.length > 0) {
				const item = queue.shift()!;
				try { await worker(item); } catch (e) { console.error('[worker]', e); }
			}
		})());
	}
	await Promise.all(runners);
}
```

Then update `src/routes/api/admin/sync-scores/+server.ts` to import it:

**Old code** (`sync-scores/+server.ts:9-26`):
```ts
const SCORE_CONCURRENCY = 3;

// §3.7 — Bounded-concurrency worker pool. Caps in-flight calculateAllScores
// calls so two concurrent syncs don't pile up dozens of contenders for the
// per-pool advisory lock.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    runners.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        try { await worker(item); } catch (e) { console.error('[worker]', e); }
      }
    })());
  }
  await Promise.all(runners);
}
```

**New code**:
```ts
import { runWithConcurrency } from '$lib/server/concurrency.js';

const SCORE_CONCURRENCY = 3;
```

---

## §Dependency order

Apply in this sequence to avoid breakage:

1. **§0.1** — add `invalidateCachedSessionByUserId` to `cache.ts`.
2. **§0.2** — create `src/lib/server/json-body.ts`.
3. **§0.3** — create `src/lib/server/concurrency.ts` and refactor `sync-scores`.
4. **§1.x security fixes** (depend on §0.1 helper).
5. **§2.x data-integrity fixes** (depend on §0.3 helper for §2.6).
6. **§3.x API-design fixes** (depend on §0.2 helper).
7. **§4.x / §5.x frontend fixes** (no cross-deps).
8. **§6.x ops/observability** (no cross-deps).
9. **§7.x code-quality** (no cross-deps).

---

## §1 — Security fixes

### §1.1 — Re-fetch / invalidate session on privilege change

**File**: `src/routes/api/admin/reset-password/+server.ts` — covered by §1.2.
**File**: `src/routes/api/auth/change-password/+server.ts` — covered by §1.3.

No separate edit beyond §1.2 and §1.3 — both call sites invoke the helper
from §0.1.

### §1.2 — `reset-password` invalidates session cache + audit log + JSON guard + errCode

Combines §1.2, §1.10, §3.1 (JSON parse), §7.5 (errCode) into one rewrite.

**File**: `src/routes/api/admin/reset-password/+server.ts`

**Old code** (entire POST handler, lines 1-31):
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db.js';
import { hashPwd } from '$lib/server/queries.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'No autorizado' }, { status: 403 });

  const { username, new_password } = await request.json();
  if (!username || !new_password || new_password.length < 6) {
    return json({ error: 'Datos inválidos' }, { status: 400 });
  }

  try {
    const hash = await hashPwd(new_password);
    const { rowCount } = await query(
      'UPDATE users SET password_hash = $1 WHERE username = $2',
      [hash, username]
    );

    if (rowCount === 0) return json({ error: 'Usuario no encontrado' }, { status: 404 });

    // Invalidate all sessions for this user
    await query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)', [username]);

    return json({ ok: true });
  } catch (e) {
    console.error('[api/admin/reset-password] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
```

**New code**:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db.js';
import { hashPwd } from '$lib/server/queries.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
import { errCode } from '$lib/server/err-code.js';
import { parseJsonBody } from '$lib/server/json-body.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'No autorizado' }, { status: 403 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { username, new_password } = body as { username?: string; new_password?: string };
  if (!username || !new_password || new_password.length < 6) {
    return json({ error: 'Datos inválidos' }, { status: 400 });
  }

  try {
    // §1.2 — Resolve the target user id BEFORE deleting their sessions so we
    // can clear the in-process session cache for that user.
    const { rows: targetRows } = await query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    const target = targetRows[0] ?? null;
    if (!target) return json({ error: 'Usuario no encontrado' }, { status: 404 });
    const targetUserId = Number(target.id);

    const hash = await hashPwd(new_password);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetUserId]);

    // Invalidate all sessions for this user (DB + in-process cache)
    await query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);
    invalidateCachedSessionByUserId(targetUserId);

    // §1.10 — Audit trail for password resets.
    await logAudit('reset_password', locals.user.id, 'user', targetUserId, null, { username });

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/reset-password] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
```

### §1.3 — `change-password` invalidates other cached sessions

**File**: `src/routes/api/auth/change-password/+server.ts`

**Old code** (lines 1-6):
```ts
import { errCode } from '$lib/server/err-code.js';
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
```

**New code**:
```ts
import { errCode } from '$lib/server/err-code.js';
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { invalidateCachedSession } from '$lib/server/cache.js';
```

**Old code** (lines 24-27):
```ts
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPwd(new_password), locals.user.id]);
    // Invalidate all other sessions (keep current one alive)
    await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [locals.user.id, cookies.get('session')]);
    return json({ ok: true });
```

**New code**:
```ts
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPwd(new_password), locals.user.id]);
    // §1.3 — Capture other sessions BEFORE deletion so we can clear their
    // entries from the in-process session cache (otherwise a stolen cookie
    // remains "valid" against the cache for up to 60s after this call).
    const currentToken = cookies.get('session');
    const { rows: otherTokens } = await query(
      'SELECT token FROM sessions WHERE user_id = $1 AND token != $2',
      [locals.user.id, currentToken]
    );
    await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [locals.user.id, currentToken]);
    for (const row of otherTokens) {
      invalidateCachedSession(row.token);
    }
    return json({ ok: true });
```

### §1.4 — `/api/predictions/group` guard before `Object.entries`

**File**: `src/routes/api/predictions/group/+server.ts`

**Old code** (lines 64-76):
```ts
  const { prediction_id, groups: rawGroups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };
  // Normalize keys to uppercase so 'a' and 'A' are treated identically
  const groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};
  for (const [k, v] of Object.entries(rawGroups)) {
    groups[k.toUpperCase()] = v;
  }

  if (!prediction_id || !groups) {
    return json({ error: 'Falta prediction_id o grupos' }, { status: 400 });
  }
```

**New code**:
```ts
  if (!body || typeof body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { prediction_id, groups: rawGroups } = body as {
    prediction_id?: number;
    groups?: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };
  // §1.4 — Guard before Object.entries; rawGroups may be undefined.
  if (!prediction_id || !rawGroups || typeof rawGroups !== 'object') {
    return json({ error: 'Falta prediction_id o grupos' }, { status: 400 });
  }
  // Normalize keys to uppercase so 'a' and 'A' are treated identically
  const groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};
  for (const [k, v] of Object.entries(rawGroups)) {
    groups[k.toUpperCase()] = v;
  }
```

Also tighten the `> 32` cap to `> 12` per §3.6:

**Old code** (lines 78-80):
```ts
  if (Object.keys(groups).length > 32) {
    return json({ error: 'Demasiados grupos' }, { status: 400 });
  }
```

**New code**:
```ts
  // §3.6 — There are only 12 real groups; anything beyond that is abuse.
  if (Object.keys(groups).length > 12) {
    return json({ error: 'Demasiados grupos' }, { status: 400 });
  }
```

### §1.5 — `/api/auth/[action]` register + login body guard

**File**: `src/routes/api/auth/[action]/+server.ts`

**Old code** (line 51):
```ts
  if (action === 'register') {
    const { username, password, display_name } = body;
```

**New code**:
```ts
  if (action === 'register') {
    if (!body || typeof body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { username, password, display_name } = body as Record<string, any>;
```

**Old code** (line 79-80):
```ts
  if (action === 'login') {
    const { username, password } = body;
```

**New code**:
```ts
  if (action === 'login') {
    if (!body || typeof body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { username, password } = body as Record<string, any>;
```

### §1.6 + §1.8 — Tiebreaker: JSON-parse guard + mixed-null rejection

**File**: `src/routes/api/predictions/tiebreaker/+server.ts`

**Old code** (lines 41-58):
```ts
  const body = await request.json();
  const { prediction_id, home_score, away_score } = body as {
    prediction_id: number;
    home_score: number | null;
    away_score: number | null;
  };

  if (!prediction_id) return json({ error: 'Falta prediction_id' }, { status: 400 });

  // Validate scores
  if (home_score !== null && away_score !== null) {
    if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
      return json({ error: 'Los goles deben ser números enteros' }, { status: 400 });
    }
    if (home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
      return json({ error: 'Goles fuera de rango (0-30)' }, { status: 400 });
    }
  }
```

**New code**:
```ts
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { prediction_id, home_score, away_score } = body as {
    prediction_id?: number;
    home_score?: number | null;
    away_score?: number | null;
  };

  if (!prediction_id) return json({ error: 'Falta prediction_id' }, { status: 400 });

  // §1.6 — Reject mixed-null state. The caller must either set both goals
  // or clear both; otherwise the save branch would silently delete the row
  // and surface a misleading "saved" status to the client.
  const h = home_score ?? null;
  const a = away_score ?? null;
  if ((h === null) !== (a === null)) {
    return json({ error: 'Debes indicar ambos goles o ninguno' }, { status: 400 });
  }

  // Validate scores
  if (h !== null && a !== null) {
    if (!Number.isInteger(h) || !Number.isInteger(a)) {
      return json({ error: 'Los goles deben ser números enteros' }, { status: 400 });
    }
    if (h < 0 || a < 0 || h > 30 || a > 30) {
      return json({ error: 'Goles fuera de rango (0-30)' }, { status: 400 });
    }
  }
```

Then replace the two later uses of `home_score`/`away_score` (lines 87 and 92)
with `h` / `a`:

**Old code** (lines 87-97):
```ts
    let action: 'saved' | 'deleted';
    if (home_score !== null && away_score !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, home_score, away_score]);
      action = 'saved';
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
      action = 'deleted';
    }
```

**New code**:
```ts
    let action: 'saved' | 'deleted';
    if (h !== null && a !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, h, a]);
      action = 'saved';
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
      action = 'deleted';
    }
```

### §1.7 — `/api/admin/scoring` allows site-admin

**File**: `src/routes/api/admin/scoring/+server.ts`

**Old code** (lines 21-25):
```ts
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [poolId]);
    const pool = poolRows[0] ?? null;
    if (!pool || pool.created_by !== locals.user.id) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }
```

**New code** (same change applied to both occurrences — the GET at line 21
AND the POST at line 50):
```ts
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [poolId]);
    const pool = poolRows[0] ?? null;
    // §1.7 — Pool creator OR site admin can manage scoring rules.
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }
```

**Old code** (lines 50-54, POST handler):
```ts
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    if (!pool || pool.created_by !== locals.user.id) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }
```

**New code**:
```ts
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    // §1.7 — Pool creator OR site admin can manage scoring rules.
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }
```

Also wrap the POST `request.json()` per §3.1, see §3.1 below.

### §1.9 — `/api/admin/payment` JSON-parse + boolean coercion + rowCount check

**File**: `src/routes/api/admin/payment/+server.ts`

**Old code** (lines 8-26):
```ts
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { pool_id, user_id, entry_id, has_paid } = await request.json() as {
      pool_id: number; user_id?: number; entry_id?: number; has_paid: boolean;
    };

    if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
    if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });

    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    // B7-3: El creador de la quiniela O el admin del sitio pueden gestionar pagos
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    const val = has_paid ? true : false;
```

**New code**:
```ts
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { pool_id, user_id, entry_id, has_paid } = parsed.body as {
      pool_id?: number; user_id?: number; entry_id?: number; has_paid?: unknown;
    };

    if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
    if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });

    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    // B7-3: El creador de la quiniela O el admin del sitio pueden gestionar pagos
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    // §1.9 — Strict boolean coercion; "no"/"false"/0 must not become true.
    const val = has_paid === true;
```

Add the import at the top:
**Old code** (lines 1-3):
```ts
import { query, getClient } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
```

**New code**:
```ts
import { query, getClient } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
```

§3.2 (also §1.9 third paragraph): 404 on rowCount=0 for the single-entry path.

**Old code** (lines 32-39):
```ts
      if (entry_id) {
        // Single entry — also get user_id for pool_members update
        const { rows: entryRows } = await client.query('SELECT user_id FROM predictions WHERE id = $1 AND pool_id = $2', [entry_id, pool_id]);
        const entry = entryRows[0] ?? null;
        await client.query('UPDATE predictions SET has_paid = $1 WHERE id = $2 AND pool_id = $3', [val, entry_id, pool_id]);
        if (entry?.user_id) {
          await client.query('UPDATE pool_members SET has_paid = $1 WHERE pool_id = $2 AND user_id = $3', [val, pool_id, entry.user_id]);
        }
      } else if (user_id) {
```

**New code**:
```ts
      if (entry_id) {
        // Single entry — also get user_id for pool_members update
        const { rows: entryRows } = await client.query('SELECT user_id FROM predictions WHERE id = $1 AND pool_id = $2', [entry_id, pool_id]);
        const entry = entryRows[0] ?? null;
        // §3.2 — Surface a 404 when entry_id is cross-pool or missing so
        // automated probes are detectable and the client sees a real error.
        if (!entry) {
          await client.query('ROLLBACK');
          return json({ error: 'Entrada no encontrada' }, { status: 404 });
        }
        await client.query('UPDATE predictions SET has_paid = $1 WHERE id = $2 AND pool_id = $3', [val, entry_id, pool_id]);
        if (entry?.user_id) {
          await client.query('UPDATE pool_members SET has_paid = $1 WHERE pool_id = $2 AND user_id = $3', [val, pool_id, entry.user_id]);
        }
      } else if (user_id) {
```

And tighten the final catch to use `errCode()` per §7.5:

**Old code** (lines 55-58):
```ts
    return json({ ok: true });
  } catch (e) {
    console.error('[api/admin/payment] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/payment] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

### §1.12 — Origin-check: gate LAN collapse on dev

**File**: `src/hooks.server.ts`

**Old code** (lines 46-58):
```ts
          // Also collapse private LAN IPs to localhost so that accessing via
          // http://192.168.x.x:3000 from another machine on the same network
          // doesn't trigger a cross-origin rejection.
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
```

**New code**:
```ts
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
```

### §1.13 — `/api/admin/backup` PUT name allowlist

**File**: `src/routes/api/admin/backup/+server.ts`

**Old code** (line 51):
```ts
    // Validate filename (no path traversal)
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      return json({ error: 'Nombre inválido' }, { status: 400 });
    }
```

**New code**:
```ts
    // §1.13 — Strict allowlist: alphanumerics + hyphen/underscore only. Blocks
    // %xx-encoded variants, null bytes, Windows-drive prefixes, and the
    // `/`, `\`, `..` cases above.
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return json({ error: 'Nombre inválido' }, { status: 400 });
    }
```

### §1.14 — Invite-code length mismatch

**File**: `src/routes/api/pools/join/+server.ts`

**Old code** (lines 14-17):
```ts
		// B3-3: Validar formato del código antes de consultar la BD (16 chars base64url)
		if (!/^[A-Za-z0-9_-]{16}$/.test(code)) {
			return json({ error: 'Código de invitación inválido' }, { status: 400 });
		}
```

**New code**:
```ts
		// §1.14 — Match generateInviteCode() which now emits 24-char uppercase
		// base64url. Anything else is malformed.
		if (!/^[A-Z0-9_-]{24}$/.test(code.toUpperCase())) {
			return json({ error: 'Código de invitación inválido' }, { status: 400 });
		}
```

---

## §2 — Data integrity

### §2.2 — Reject duplicate team picks within a phase

**File**: `src/routes/api/predictions/bracket/+server.ts`

Insert directly AFTER the team-ID validation block (after line 160, before the
B5-3 cross-phase consistency block at line 162).

**Old code** (lines 157-162):
```ts
  const teamsMap = await getTeamsMapCached();
  for (const id of allTeamIds) {
    if (!teamsMap[id]) return json({ error: `Equipo inválido (id: ${id})` }, { status: 400 });
  }

  // B5-3: Cross-phase consistency check.
```

**New code**:
```ts
  const teamsMap = await getTeamsMapCached();
  for (const id of allTeamIds) {
    if (!teamsMap[id]) return json({ error: `Equipo inválido (id: ${id})` }, { status: 400 });
  }

  // §2.2 — Reject duplicate team picks within a single phase. A crafted
  // payload could otherwise place the same team in N slots and collect Nx
  // the per-pick points when that team wins.
  for (const [phase, slots] of Object.entries(picks)) {
    const seen = new Set<number>();
    for (const teamId of Object.values(slots)) {
      if (teamId === null) continue;
      if (seen.has(teamId)) {
        return json({ error: `Equipo repetido en fase ${phase}` }, { status: 400 });
      }
      seen.add(teamId);
    }
  }

  // B5-3: Cross-phase consistency check.
```

### §2.3 — Group H2H tiebreaker

**File**: `src/lib/server/scoring.ts`

**Old code** (lines 64-75):
```ts
  // Rank teams per group (by points, then GD, then GF)
  const actualPositions: Record<string, number[]> = {}; // group -> [pos1_teamId, pos2, pos3, pos4]
  for (const [group, teams] of Object.entries(standings)) {
    // TODO (B6-6): La clasificación usa puntos → dif. de goles → goles a favor.
    // El desempate oficial de la FIFA incluye resultados directos entre los equipos empatados
    // antes de aplicar las diferencias globales. Implementar desempate H2H requiere
    // una PR dedicada con casos de prueba para ciclos de 3/4 equipos.
    const sorted = Object.entries(teams)
      .map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga }))
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    actualPositions[group] = sorted.map(t => t.id);
  }
```

**New code**:
```ts
  // §2.3 — FIFA tiebreaker: points → H2H points → H2H GD → H2H GF →
  // overall GD → overall GF. We compute H2H only across the subset of teams
  // tied on overall points, then fall back to the global stats.
  function rankGroup(group: string, teams: Record<number, { points: number; gf: number; ga: number }>): number[] {
    const ids = Object.keys(teams).map(Number);
    // Cluster teams by their overall points.
    const groupMatches = matches.filter(m => m.group_name === group);

    function h2hStats(subset: Set<number>): Map<number, { points: number; gf: number; ga: number }> {
      const out = new Map<number, { points: number; gf: number; ga: number }>();
      for (const id of subset) out.set(id, { points: 0, gf: 0, ga: 0 });
      for (const m of groupMatches) {
        if (!subset.has(m.home_team_id) || !subset.has(m.away_team_id)) continue;
        const h = out.get(m.home_team_id)!;
        const a = out.get(m.away_team_id)!;
        h.gf += m.home_score; h.ga += m.away_score;
        a.gf += m.away_score; a.ga += m.home_score;
        if (m.home_score > m.away_score) h.points += 3;
        else if (m.home_score < m.away_score) a.points += 3;
        else { h.points += 1; a.points += 1; }
      }
      return out;
    }

    // First sort by overall points only; then break ties via H2H within
    // each cluster, then fall back to overall GD/GF.
    const initial = ids.map(id => ({ id, ...teams[id], gd: teams[id].gf - teams[id].ga }));
    initial.sort((a, b) => b.points - a.points);

    const finalOrder: number[] = [];
    let i = 0;
    while (i < initial.length) {
      let j = i + 1;
      while (j < initial.length && initial[j].points === initial[i].points) j++;
      const cluster = initial.slice(i, j);
      if (cluster.length === 1) {
        finalOrder.push(cluster[0].id);
      } else {
        const subset = new Set(cluster.map(c => c.id));
        const h2h = h2hStats(subset);
        cluster.sort((a, b) => {
          const ah = h2h.get(a.id)!;
          const bh = h2h.get(b.id)!;
          if (bh.points !== ah.points) return bh.points - ah.points;
          const ahGd = ah.gf - ah.ga;
          const bhGd = bh.gf - bh.ga;
          if (bhGd !== ahGd) return bhGd - ahGd;
          if (bh.gf !== ah.gf) return bh.gf - ah.gf;
          if (b.gd !== a.gd) return b.gd - a.gd;
          return b.gf - a.gf;
        });
        for (const c of cluster) finalOrder.push(c.id);
      }
      i = j;
    }
    return finalOrder;
  }

  const actualPositions: Record<string, number[]> = {};
  for (const [group, teams] of Object.entries(standings)) {
    actualPositions[group] = rankGroup(group, teams);
  }
```

### §2.4 — `syncScores` skip incomplete scores

**File**: `src/lib/server/live-scores.ts`

**Old code** (lines 62-73, api-football branch):
```ts
    for (const fixture of (data.response || [])) {
      matches.push({
        fifa_id: String(fixture.fixture.id),
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_score: fixture.goals.home ?? 0,
        away_score: fixture.goals.away ?? 0,
        status: 'finished',
        phase: mapRoundToPhase(fixture.fixture.round),
        kickoff_time: fixture.fixture.date ? new Date(fixture.fixture.date) : null,
      });
    }
```

**New code**:
```ts
    for (const fixture of (data.response || [])) {
      // §2.4 — Upstream "finished" matches can still arrive with null goals
      // (abandoned, walkover, ingestion lag). Skip rather than write 0-0.
      const homeScore = fixture.goals?.home;
      const awayScore = fixture.goals?.away;
      if (homeScore == null || awayScore == null) continue;
      matches.push({
        fifa_id: String(fixture.fixture.id),
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_score: homeScore,
        away_score: awayScore,
        status: 'finished',
        phase: mapRoundToPhase(fixture.fixture.round),
        kickoff_time: fixture.fixture.date ? new Date(fixture.fixture.date) : null,
      });
    }
```

**Old code** (lines 112-123, FIFA branch):
```ts
		for (const m of data.results) {
      matches.push({
        fifa_id: String(m.idMatch),
        home_team: m.home?.teamName ?? '',
        away_team: m.away?.teamName ?? '',
        home_score: m.home?.score ?? 0,
        away_score: m.away?.score ?? 0,
        status: m.matchStatus === 'Completed' ? 'finished' : 'live',
        phase: mapFifaStageToPhase(m.idStage),
        kickoff_time: m.date ? new Date(m.date) : null,
      });
    }
```

**New code**:
```ts
		for (const m of data.results) {
      // §2.4 — Skip rows missing a score rather than coercing to 0.
      const homeScore = m.home?.score;
      const awayScore = m.away?.score;
      if (homeScore == null || awayScore == null) continue;
      matches.push({
        fifa_id: String(m.idMatch),
        home_team: m.home?.teamName ?? '',
        away_team: m.away?.teamName ?? '',
        home_score: homeScore,
        away_score: awayScore,
        status: m.matchStatus === 'Completed' ? 'finished' : 'live',
        phase: mapFifaStageToPhase(m.idStage),
        kickoff_time: m.date ? new Date(m.date) : null,
      });
    }
```

### §2.5 — Skip `phase === 'unknown'` imports

**File**: `src/lib/server/live-scores.ts`

**Old code** (lines 152-153):
```ts
  for (const m of matches) {
    if (m.status !== 'finished') { skipped++; continue; }
```

**New code**:
```ts
  for (const m of matches) {
    if (m.status !== 'finished') { skipped++; continue; }
    // §2.5 — Refuse imports with an unmapped FIFA stage ID; otherwise the
    // unknown phase would silently slip past scoring queries that filter
    // by phase. Replace the stub stage IDs in FIFA_STAGE_MAP before kickoff.
    if (m.phase === 'unknown') { skipped++; continue; }
```

### §2.6 — `/api/admin/results` uses `runWithConcurrency`

**File**: `src/routes/api/admin/results/+server.ts`

**Old code** (lines 1-7):
```ts
import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
```

**New code**:
```ts
import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
import { runWithConcurrency } from '$lib/server/concurrency.js';
```

**Old code** (lines 73-85):
```ts
    // Sync rescoring — score all pools before responding
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    const poolIds = pools.map((p: any) => p.id);

    for (const poolId of poolIds) {
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[score] admin/results pool ${poolId}:`, e);
      }
    }
    invalidateGlobalLeaderboard();
```

**New code**:
```ts
    // §2.6 — Score pools concurrently (cap 3) so manual results don't
    // produce a request that blocks for the sequential sum of all pools.
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    const poolIds = pools.map((p: any) => p.id);

    await runWithConcurrency(poolIds, 3, async (poolId) => {
      // §2.9 — Re-check is_active to match sync-scores semantics.
      const { rows: stillActive } = await query(
        'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
        [poolId]
      );
      if (stillActive.length === 0) return;
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[score] admin/results pool ${poolId}:`, e);
      }
    });
    invalidateGlobalLeaderboard();
```

### §2.7 — `/api/admin/recalculate` invalidates caches + errCode + JSON-parse + audit-pre-op

**File**: `src/routes/api/admin/recalculate/+server.ts`

**Old code** (lines 1-29):
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';

// POST /api/admin/recalculate
// Body: { pool_id }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const { pool_id } = await request.json() as { pool_id: number };

  // Verify user owns this pool
  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    await calculateAllScores(pool_id);
    await logAudit('recalculate', locals.user.id, 'pool', pool_id, null, null);
    return json({ ok: true });
  } catch (e) {
    console.error('Recalculate error:', e);
    return json({ error: 'Error al recalcular' }, { status: 500 });
  }
};
```

**New code**:
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { errCode } from '$lib/server/err-code.js';
import { parseJsonBody } from '$lib/server/json-body.js';

// POST /api/admin/recalculate
// Body: { pool_id }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { pool_id } = parsed.body as { pool_id?: number };
  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  // Verify user owns this pool
  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    await calculateAllScores(pool_id);
    // §2.7 — Invalidate caches so the admin's manual recalculate is visible
    // immediately instead of after the 30-60s TTL.
    invalidateCachedPoolLeaderboard(pool_id);
    invalidateCachedPoolResults(pool_id);
    invalidateGlobalLeaderboard();
    await logAudit('recalculate', locals.user.id, 'pool', pool_id, null, null);
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/recalculate] ${code}:`, e);
    return json({ error: 'Error al recalcular', code }, { status: 500 });
  }
};
```

### §2.8 — `match-scores` drop started matches instead of rejecting the batch

**File**: `src/routes/api/predictions/match-scores/+server.ts`

**Old code** (lines 59-86):
```ts
  const matchIds = Object.keys(scores).map(Number);
  if (matchIds.length > 0) {
    // Per-match kickoff deadline: reject if any match has already started
    const { rows: started } = await query(
      'SELECT id FROM matches WHERE id = ANY($1::int[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()',
      [matchIds]
    );
    if (started.length > 0) {
      return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
    }

    // Also check pool-level phase deadlines
    const { rows: phaseRows } = await query(`
      SELECT
        MAX(CASE WHEN phase = 'group' THEN 1 ELSE 0 END) AS has_group,
        MAX(CASE WHEN phase != 'group' THEN 1 ELSE 0 END) AS has_knockout
      FROM matches WHERE id = ANY($1::int[])
    `, [matchIds]);
    const phaseRow = phaseRows[0] ?? null;

    const now = new Date();
    if (phaseRow?.has_group && poolCheck?.deadline_group && new Date(poolCheck.deadline_group) <= now) {
      return json({ error: 'La fecha límite de fase de grupos ha pasado' }, { status: 403 });
    }
    if (phaseRow?.has_knockout && poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= now) {
      return json({ error: 'La fecha límite de eliminatorias ha pasado' }, { status: 403 });
    }
  }
```

**New code**:
```ts
  // §3.3 — Validate each match id is a positive integer up-front so a non-numeric
  // key cannot cascade into a NaN INSERT later.
  for (const k of Object.keys(scores)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) {
      return json({ error: `match id inválido: ${k}` }, { status: 400 });
    }
  }
  const matchIds = Object.keys(scores).map(Number);
  const droppedMatches: number[] = [];
  if (matchIds.length > 0) {
    // §2.8 — Drop matches that have already started instead of rejecting
    // the whole batch. Mirrors the group/bracket pattern so the autosave
    // path doesn't lose unrelated edits.
    const { rows: started } = await query(
      'SELECT id FROM matches WHERE id = ANY($1::int[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()',
      [matchIds]
    );
    const startedSet = new Set(started.map((r: any) => Number(r.id)));
    for (const id of startedSet) {
      delete (scores as Record<string, unknown>)[String(id)];
      droppedMatches.push(id);
    }
    const remainingIds = Object.keys(scores).map(Number);

    // Also check pool-level phase deadlines (against remaining matches).
    if (remainingIds.length > 0) {
      const { rows: phaseRows } = await query(`
        SELECT
          MAX(CASE WHEN phase = 'group' THEN 1 ELSE 0 END) AS has_group,
          MAX(CASE WHEN phase != 'group' THEN 1 ELSE 0 END) AS has_knockout
        FROM matches WHERE id = ANY($1::int[])
      `, [remainingIds]);
      const phaseRow = phaseRows[0] ?? null;

      const now = new Date();
      if (phaseRow?.has_group && poolCheck?.deadline_group && new Date(poolCheck.deadline_group) <= now) {
        return json({ error: 'La fecha límite de fase de grupos ha pasado' }, { status: 403 });
      }
      if (phaseRow?.has_knockout && poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= now) {
        return json({ error: 'La fecha límite de eliminatorias ha pasado' }, { status: 403 });
      }
    }
  }
```

And include `dropped` in the success response (§2.8 + §3.3).

**Old code** (line 156):
```ts
  return json({ ok: true });
```

**New code**:
```ts
  return json({ ok: true, dropped: droppedMatches });
```

### §2.10 — `migrate.ts` misleading comment

**File**: `src/lib/server/migrate.ts`

**Old code** (lines 4-9):
```ts
 * Reads SQL files from:
 *   - drizzle/migrations/*.sql
 *   - src/lib/server/migrations/*.sql
 *
 * Tracks applied migrations in the _migrations table so each file
 * runs exactly once. Combined with idempotent SQL (IF NOT EXISTS,
```

**New code**:
```ts
 * Reads SQL files from:
 *   - drizzle/migrations/*.sql
 *
 * Tracks applied migrations in the _migrations table so each file
 * runs exactly once. Combined with idempotent SQL (IF NOT EXISTS,
```

### §2.11 — Bracket save triggers rescoring + cache invalidation

**File**: `src/routes/api/predictions/bracket/+server.ts`

**Old code** (lines 1-6):
```ts
import { errCode } from '$lib/server/err-code.js';
import { query, getClient } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

**New code**:
```ts
import { errCode } from '$lib/server/err-code.js';
import { query, getClient } from '$lib/server/db.js';
import {
  getTeamsMapCached,
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

**Old code** (lines 242-243):
```ts
    await client.query('COMMIT');
    return json({ ok: true, dropped: droppedPhases });
```

**New code**:
```ts
    await client.query('COMMIT');

    // §2.11 — If any knockout match is already finished, the user just edited
    // a pick that affects total_score. Rescore inline so the UI reflects
    // the new total immediately, matching the match-scores POST behaviour.
    try {
      const { rows: anyFinished } = await query(
        `SELECT 1 FROM matches
         WHERE phase IN ('r32','r16','qf','sf','final','3rd')
           AND status = 'finished'
         LIMIT 1`
      );
      if (anyFinished.length > 0) {
        await calculateAllScores(pred.pool_id);
        invalidateCachedPoolLeaderboard(pred.pool_id);
        invalidateCachedPoolResults(pred.pool_id);
        invalidateGlobalLeaderboard();
      }
    } catch (e) {
      const code = errCode();
      console.error(`[api/predictions/bracket] rescore ${code}:`, e);
    }

    return json({ ok: true, dropped: droppedPhases });
```

---

## §3 — API design

### §3.1 — Wrap `request.json()` everywhere with `parseJsonBody`

For each file below, replace the unwrapped `await request.json()` with:

```ts
const parsed = await parseJsonBody(request);
if (!parsed.ok) return parsed.response;
if (!parsed.body || typeof parsed.body !== 'object') {
	return json({ error: 'Cuerpo inválido' }, { status: 400 });
}
const body = parsed.body as <SAME-TYPE-AS-BEFORE>;
```

Each fix below shows the precise edit per file.

#### §3.1a — `src/routes/api/admin/scoring/+server.ts`

Add the import at the top:

**Old code** (lines 1-6):
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getScoringRules } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';
```

**New code**:
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getScoringRules } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
```

**Old code** (lines 39-47):
```ts
  const body = await request.json() as {
    pool_id: number;
    rules?: Record<string, number>;
    deadline_group?: string | null;
    deadline_knockout?: string | null;
  };
  const { pool_id, rules } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
```

**New code**:
```ts
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const body = parsed.body as {
    pool_id?: number;
    rules?: Record<string, number>;
    deadline_group?: string | null;
    deadline_knockout?: string | null;
  };
  const { pool_id, rules } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
```

Tighten both catches per §7.5 (GET line 29, POST line 96):

**Old code** (lines 28-31, GET catch):
```ts
  } catch (e) {
    console.error('[api/admin/scoring] GET error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/scoring] GET ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

**Old code** (lines 95-98, POST catch):
```ts
  } catch (e) {
    console.error('[api/admin/scoring] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/scoring] POST ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

#### §3.1b — `src/routes/api/admin/pool-settings/+server.ts`

**Old code** (lines 1-4):
```ts
import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';
```

**New code**:
```ts
import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { parseJsonBody } from '$lib/server/json-body.js';
```

**Old code** (lines 9-11):
```ts
  try {
    const body = await request.json();
    const { pool_id, allow_multiple_predictions } = body;
```

**New code**:
```ts
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { pool_id, allow_multiple_predictions } = parsed.body as {
      pool_id?: number; allow_multiple_predictions?: unknown;
    };
```

#### §3.1c — `src/routes/api/admin/pool-creators/+server.ts`

**Old code** (lines 1-3):
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
```

**New code**:
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
```

**Old code** (lines 14-15, POST):
```ts
    const { user_id } = await request.json() as { user_id: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });
```

**New code**:
```ts
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { user_id } = parsed.body as { user_id?: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });
```

**Old code** (lines 34-35, DELETE):
```ts
    const { user_id } = await request.json() as { user_id: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });
```

**New code**:
```ts
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { user_id } = parsed.body as { user_id?: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });
```

Tighten both catches per §7.5:

**Old code** (line 20):
```ts
    console.error('[api/admin/pool-creators] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
```

**New code**:
```ts
    const code = errCode();
    console.error(`[api/admin/pool-creators] POST ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
```

**Old code** (line 40):
```ts
    console.error('[api/admin/pool-creators] DELETE error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
```

**New code**:
```ts
    const code = errCode();
    console.error(`[api/admin/pool-creators] DELETE ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
```

Additionally, the existing handler calls `query('SELECT is_admin FROM users…')` to verify admin instead of reading `locals.user.is_admin`. Leave alone — defence-in-depth, and the §1.1 cache-invalidate change now keeps `locals.user.is_admin` honest anyway. After §1.1, those redundant queries can be removed in a follow-up.

#### §3.1d — `src/routes/api/admin/settings/+server.ts`

**Old code** (lines 1-3):
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
```

**New code**:
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
```

**Old code** (lines 13-14):
```ts
    const { key, value } = await request.json() as { key: string; value: string };
    if (!key || !value) return json({ error: 'Faltan campos' }, { status: 400 });
```

**New code**:
```ts
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { key, value } = parsed.body as { key?: string; value?: string };
    // §3.8 — value may legitimately be the empty string; only reject when
    // it is undefined or null.
    if (!key || value == null) return json({ error: 'Faltan campos' }, { status: 400 });
```

Tighten the catch per §7.5:

**Old code** (lines 24-27):
```ts
  } catch (e) {
    console.error('[api/admin/settings] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/settings] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

#### §3.1e — `src/routes/api/admin/backup/+server.ts`

Add the import:

**Old code** (lines 1-4):
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createBackup, listBackups, restoreBackup } from '$lib/server/backup.js';
import { query } from '$lib/server/db.js';
```

**New code**:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createBackup, listBackups, restoreBackup } from '$lib/server/backup.js';
import { query } from '$lib/server/db.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
```

**Old code** (lines 14-15, POST):
```ts
    const { label = 'manual' } = await request.json() as { label?: string };
    const backup = createBackup(label);
```

**New code**:
```ts
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = (parsed.body && typeof parsed.body === 'object' ? parsed.body : {}) as { label?: string };
    const { label = 'manual' } = body;
    const backup = createBackup(label);
```

**Old code** (lines 47-48, PUT):
```ts
    const { name } = await request.json() as { name: string };
    if (!name) return json({ error: 'Falta nombre del backup' }, { status: 400 });
```

**New code**:
```ts
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { name } = parsed.body as { name?: string };
    if (!name) return json({ error: 'Falta nombre del backup' }, { status: 400 });
```

Tighten the three catches per §7.5:

**Old code** (lines 17-19, POST catch):
```ts
  } catch (e) {
    console.error('[api/admin/backup] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/backup] POST ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

**Old code** (lines 32-34, GET catch):
```ts
  } catch (e) {
    console.error('[api/admin/backup] GET error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/backup] GET ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

**Old code** (lines 57-60, PUT catch):
```ts
  } catch (e: any) {
    console.error('[api/admin/backup] PUT error:', e);
    return json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
```

**New code**:
```ts
  } catch (e: any) {
    const code = errCode();
    console.error(`[api/admin/backup] PUT ${code}:`, e);
    return json({ error: e.message ?? 'Internal server error', code }, { status: 500 });
  }
```

### §3.2 — `/api/admin/payment` 404 on rowCount=0

Already merged into §1.9 above.

### §3.3 — `match-scores` validate integer keys

Already merged into §2.8 above (the up-front `Number.isInteger` loop).

### §3.7 — `/api/admin/fifa-sync` uses `runWithConcurrency` + errCode

**File**: `src/routes/api/admin/fifa-sync/+server.ts`

**Old code** (lines 1-6):
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
```

**New code**:
```ts
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { runWithConcurrency } from '$lib/server/concurrency.js';
import { errCode } from '$lib/server/err-code.js';
```

**Old code** (lines 23-41):
```ts
    // In production, this would call the FIFA sync script
    // const updated = await syncFromFifa();

    // Recalculate scores regardless (useful after manual edits)
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    for (const p of pools) {
      await calculateAllScores(p.id);
      invalidateCachedPoolLeaderboard(p.id);
      invalidateCachedPoolResults(p.id);
    }
    invalidateGlobalLeaderboard();

    return json({
      ok: true,
      updated: 0,
      message: 'FIFA sync will be active closer to the tournament. Scores recalculated.',
      pools: pools.length,
    });
  } catch (e) {
    console.error('FIFA sync error:', e);
    return json({ error: 'Error en sincronización' }, { status: 500 });
  }
```

**New code**:
```ts
    // In production, this would call the FIFA sync script
    // const updated = await syncFromFifa();

    // §3.7 — Cap concurrent rescores so two simultaneous syncs don't pile
    // up on the per-pool advisory lock.
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    const poolIds = pools.map((p: any) => p.id);
    await runWithConcurrency(poolIds, 3, async (poolId) => {
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[score] fifa-sync pool ${poolId}:`, e);
      }
    });
    invalidateGlobalLeaderboard();

    return json({
      ok: true,
      updated: 0,
      message: 'FIFA sync will be active closer to the tournament. Scores recalculated.',
      pools: pools.length,
    });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/fifa-sync] ${code}:`, e);
    return json({ error: 'Error en sincronización', code }, { status: 500 });
  }
```

### §3.8 — `/api/admin/settings` allow empty-string value

Already merged into §3.1d above.

---

## §4 — Frontend / Svelte 5

### §4.1 — `predict/+page.svelte` matchScores guard against overwrite

**File**: `src/routes/pool/[id]/predict/+page.svelte`

**Old code** (lines 285-286):
```svelte
  let matchScores = $state({});
  $effect(() => { matchScores = JSON.parse(JSON.stringify(matchScoresInit)); });
```

**New code**:
```svelte
  let matchScores = $state({});
  // §4.1 — Mirror the _activeEdits guard used for `selections`. Only overwrite
  // entries the user is not currently editing so a soft navigation
  // invalidate doesn't blow away unsaved typing.
  const _activeMatchEdits = new Set();
  $effect(() => {
    const fresh = JSON.parse(JSON.stringify(matchScoresInit));
    const next = { ...matchScores };
    for (const [matchIdStr, score] of Object.entries(fresh)) {
      const matchId = Number(matchIdStr);
      if (!_activeMatchEdits.has(matchId)) {
        next[matchId] = score;
      }
    }
    matchScores = next;
  });
```

And mark a match as being actively edited inside `setMatchScore`:

**Old code** (lines 323-329):
```svelte
  function setMatchScore(matchId, side, value) {
    const score = matchScores[matchId] || { home: null, away: null };
    if (side === 'home') score.home = value;
    else score.away = value;
    matchScores[matchId] = score;
    autoSaveMatchScores();
  }
```

**New code**:
```svelte
  function setMatchScore(matchId, side, value) {
    const score = matchScores[matchId] || { home: null, away: null };
    if (side === 'home') score.home = value;
    else score.away = value;
    matchScores[matchId] = score;
    _activeMatchEdits.add(Number(matchId));
    autoSaveMatchScores();
  }
```

And clear the set after a successful save:

**Old code** (lines 318-321):
```svelte
      if (res.ok) { matchSaved = true; setTimeout(() => matchSaved = false, 2000); }
    } catch (e) { console.error(e); }
    finally { matchSaving = false; }
  }
```

**New code**:
```svelte
      if (res.ok) {
        matchSaved = true;
        _activeMatchEdits.clear();
        setTimeout(() => matchSaved = false, 2000);
      } else {
        // §4.3 — Surface the save failure to the user instead of swallowing it.
        const body = await res.json().catch(() => ({}));
        showToast('⚠️ ' + (body.error || 'Error al guardar marcadores'));
      }
    } catch (e) {
      console.error(e);
      showToast('⚠️ Error al guardar marcadores — inténtalo de nuevo');
    }
    finally { matchSaving = false; }
  }
```

### §4.2 — `bracket/+page.svelte` switchEntry uses `goto`

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

Add `goto` import at the top of the script block:

**Old code** (lines 2-5):
```svelte
  import { showToast } from '$lib/toast';
  import { haptic } from '$lib/haptic';
  import { headerTitle } from '$lib/stores/header';
  import { flagEmoji, shortName } from '$lib/teams.js';
```

**New code**:
```svelte
  import { showToast } from '$lib/toast';
  import { haptic } from '$lib/haptic';
  import { headerTitle } from '$lib/stores/header';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import { goto } from '$app/navigation';
```

**Old code** (lines 552-557, `switchEntry`):
```svelte
  async function switchEntry(label) {
    const url = new URL(window.location.href);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    window.location.href = url.pathname + url.search;
  }
```

**New code**:
```svelte
  async function switchEntry(label) {
    // §4.2 — Flush any pending autosave before switching so the last edit
    // isn't lost. Use goto for soft navigation; window.location.href would
    // also discard the carefully-built _teams/_picks state.
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
      await saveBracket();
    }
    const url = new URL(window.location.href);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    await goto(url.pathname + url.search, { invalidateAll: true });
  }
```

**Old code** (lines 559-578, `createEntry`):
```svelte
  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true; createMsg = '';
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: data.pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        showCreateEntry = false;
        newEntryLabel = '';
        window.location.href = `/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`;
      } else {
        createMsg = d.error || 'Error';
      }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }
```

**New code**:
```svelte
  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true; createMsg = '';
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: data.pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        showCreateEntry = false;
        newEntryLabel = '';
        // §4.2 — Use goto for soft navigation; preserves any pending state.
        await goto(`/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`, { invalidateAll: true });
      } else {
        createMsg = d.error || 'Error';
      }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }
```

### §4.3 — `predict/+page.svelte` saveMatchScores surfaces errors

Already merged into §4.1 above.

### §4.4 — `bracket/+page.svelte` render `saveError`

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

**Old code** (lines 545-548 inside `saveBracket`):
```svelte
      if (res.ok) { showToast('✓ Guardado'); }
      else { saveError = 'Error al guardar'; setTimeout(() => { saveError = null; }, 3000); }
    } catch (e) { console.error(e); }
    finally { saving = false; }
```

**New code**:
```svelte
      if (res.ok) { saveError = null; showToast('✓ Guardado'); }
      else {
        const body = await res.json().catch(() => ({}));
        saveError = body.error || 'Error al guardar';
        showToast('⚠️ ' + saveError);
        setTimeout(() => { saveError = null; }, 3000);
      }
    } catch (e) {
      console.error(e);
      saveError = 'Error de conexión';
      showToast('⚠️ ' + saveError);
      setTimeout(() => { saveError = null; }, 3000);
    }
    finally { saving = false; }
```

Render the error inline so the user sees it even with toasts dismissed. Find
the `.save-area` block in the template (around line 631-640) and add the
`saveError` line:

**Old code** (lines 631-640):
```svelte
      <div class="save-area">
        <span class="pick-count">{totalPicks} picks</span>
        {#if saving}
          <span style="font-size: 10px; color: var(--text-muted);">Guardando...</span>
        {:else if saved}
          <span style="font-size: 10px; color: var(--green);">✓ Guardado</span>
        {:else}
          <span style="font-size: 10px; color: var(--text-dim);">Auto-guardado</span>
        {/if}
      </div>
```

**New code**:
```svelte
      <div class="save-area">
        <span class="pick-count">{totalPicks} picks</span>
        {#if saveError}
          <span style="font-size: 10px; color: var(--red);">⚠️ {saveError}</span>
        {:else if saving}
          <span style="font-size: 10px; color: var(--text-muted);">Guardando...</span>
        {:else if saved}
          <span style="font-size: 10px; color: var(--green);">✓ Guardado</span>
        {:else}
          <span style="font-size: 10px; color: var(--text-dim);">Auto-guardado</span>
        {/if}
      </div>
```

### §4.5 — `join/[code]/+page.svelte` double-submit guard

**File**: `src/routes/join/[code]/+page.svelte`

**Old code** (entire file lines 1-58):
```svelte
<script>
  import { onMount } from 'svelte';
  let { data } = $props();
  let error = $state('');
  let loading = $state(false);
  let joined = $state(false);

  async function handleJoin(e) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      });
      const result = await res.json();
      if (!res.ok) {
        error = result.error || 'Error';
      } else {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
      }
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
    }
  }

  // Auto-join on load — runs once after hydration, avoiding SSR double-submit
  onMount(() => {
    if (!data.code) return;
    error = '';
    loading = true;
    fetch('/api/pools/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code }),
    })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) {
          error = result.error || 'Error';
        } else {
          joined = true;
          window.location.href = `/pool/${result.pool_id}`;
        }
      })
      .catch(() => {
        error = 'Error de conexión';
      })
      .finally(() => {
        loading = false;
      });
  });
</script>
```

**New code**:
```svelte
<script>
  import { onMount } from 'svelte';
  let { data } = $props();
  let error = $state('');
  let loading = $state(false);
  let joined = $state(false);
  // §4.5 — Single-flight guard so a hydration-race click on the manual
  // form does not produce a parallel join, and so a 409 ("already in
  // this pool") is treated as success rather than as an error flash.
  let joinInFlight = false;

  async function performJoin() {
    if (joinInFlight) return;
    joinInFlight = true;
    error = '';
    loading = true;
    try {
      const res = await fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      });
      const result = await res.json();
      if (res.ok) {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
        return;
      }
      // §4.5 — 409 "Ya estás en esta quiniela" means the parallel auto-join
      // succeeded; treat it as success rather than a user-visible error.
      if (res.status === 409 && result.pool_id) {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
        return;
      }
      error = result.error || 'Error';
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
      joinInFlight = false;
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    await performJoin();
  }

  // Auto-join on load — runs once after hydration, avoiding SSR double-submit
  onMount(() => {
    if (!data.code) return;
    performJoin();
  });
</script>
```

> Note: the 409 response from `/api/pools/join` (`Ya estás en esta quiniela`) currently does NOT include `pool_id`. If that exact branch is critical, see §4.5 follow-up below — alternatively, fall through to `error = result.error` and the user can click `/join` manually. The single-flight guard alone is the minimum needed.

### §4.6 — `+layout.svelte` countdown halts when expired

**File**: `src/routes/+layout.svelte`

**Old code** (lines 38-53):
```svelte
  $effect(() => {
    if (!browser) return;
    const kickoff = WORLD_CUP_KICKOFF_MS;
    const update = () => {
      const diff = kickoff - Date.now();
      if (diff <= 0) { countdownText = ''; return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      countdownText = d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  });
```

**New code**:
```svelte
  $effect(() => {
    if (!browser) return;
    const kickoff = WORLD_CUP_KICKOFF_MS;
    let iv;
    const update = () => {
      const diff = kickoff - Date.now();
      // §4.6 — Halt the interval once kickoff has passed instead of letting
      // setInterval keep firing every second forever.
      if (diff <= 0) {
        countdownText = '';
        if (iv) { clearInterval(iv); iv = null; }
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      countdownText = d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
    };
    update();
    iv = setInterval(update, 1000);
    return () => { if (iv) clearInterval(iv); };
  });
```

### §4.9 — `+layout.svelte` stagger duplicate work

**File**: `src/routes/+layout.svelte`

**Old code** (lines 92-100):
```svelte
  onMount(() => {
    if (!browser) return;
    stagger();
  });

  $effect(() => {
    $page; // reactive dependency — re-run stagger after each navigation
    setTimeout(stagger, 100);
  });
```

**New code**:
```svelte
  // §4.9 — The $effect below already runs once on mount (it reads $page),
  // so the onMount stagger() is redundant. Keep only the effect.
  $effect(() => {
    $page; // reactive dependency — re-run stagger after each navigation
    setTimeout(stagger, 100);
  });
```

### §4.10 — Remove dead `containerEl` binding

**File**: `src/lib/components/PullToRefresh.svelte`

**Old code** (line 8):
```svelte
  let containerEl: HTMLElement | null = null;
```

**New code**: delete the entire line.

**Old code** (line 38):
```svelte
<div bind:this={containerEl} ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd} style="min-height:100%;overflow-y:auto;">
```

**New code**:
```svelte
<div ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd} style="min-height:100%;overflow-y:auto;">
```

---

## §5 — Domain logic (bracket)

### §5.1 — Reset `_thirdSlots` in `initState`

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

**Old code** (lines 204-216):
```svelte
  function initState() {
    const t = {};
    const exp = {};

    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      const team1 = m.t1g !== '?' ? getGroupTeam(m.t1g, m.t1p) : null;
      const team2 = m.t2g !== '?' ? getGroupTeam(m.t2g, m.t2p) : null;
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
```

**New code**:
```svelte
  function initState() {
    const t = {};
    const exp = {};
    // §5.1 — Reset wildcard occupants before rebuilding state. Without this,
    // soft-switching to a different entry leaves the previous entry's
    // 3rd-place picks visible in the third-place selector modal.
    _thirdSlots = {};

    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      const team1 = m.t1g !== '?' ? getGroupTeam(m.t1g, m.t1p) : null;
      const team2 = m.t2g !== '?' ? getGroupTeam(m.t2g, m.t2p) : null;
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
```

Then within the existingBracket loop, remove the now-redundant `_thirdSlots = _thirdSlots ?? {};`:

**Old code** (lines 224-231):
```svelte
        if (ti === 1 && R32_MAP[mi].t2g === '?') {
          _thirdSlots = _thirdSlots ?? {};
          _thirdSlots[mi] = data.existingBracket.r32[slot];
        } else {
          exp.r32[mi][ti] = true;
        }
```

**New code**:
```svelte
        if (ti === 1 && R32_MAP[mi].t2g === '?') {
          _thirdSlots[mi] = data.existingBracket.r32[slot];
        } else {
          exp.r32[mi][ti] = true;
        }
```

### §5.2 — Cascade clearing wipes explicit picks (documented)

Audit calls this "documented as intended" with a request for a confirm prompt.
We add a `showToast` so users know their later-phase picks were cleared, but
keep the cascade behaviour:

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

**Old code** (lines 287-310 inside `recascade`):
```svelte
  function recascade() {
    // Restore R32 from group predictions
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      if (m.t1g === '?') continue;
      _teams.r32[i][0] = getGroupTeam(m.t1g, m.t1p);
      // Only auto-fill team2 from group predictions if user hasn't explicitly picked
      if (!_picks.r32[i][1]) {
        _teams.r32[i][1] = getGroupTeam(m.t2g, m.t2p);
      }
    }

    // Cascade: R32 → R16 uses special feed-in mapping
    for (let i = 0; i < _teams.r16.length; i++) {
      for (let j = 0; j < 2; j++) {
        const winner = getWinner('r32', R32_TO_R16[i * 2 + j]);
        // Invalidate explicit pick if the team is no longer the upstream winner
        if (_picks.r16[i][j] && _teams.r16[i][j] !== winner) {
          _picks.r16[i][0] = false;
          _picks.r16[i][1] = false;
        }
        _teams.r16[i][j] = _picks.r16[i][j] ? _teams.r16[i][j] : winner;
      }
    }
```

**New code**:
```svelte
  let _cascadeClearedThisTick = false;
  function recascade() {
    _cascadeClearedThisTick = false;
    // Restore R32 from group predictions
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      if (m.t1g === '?') continue;
      _teams.r32[i][0] = getGroupTeam(m.t1g, m.t1p);
      // Only auto-fill team2 from group predictions if user hasn't explicitly picked
      if (!_picks.r32[i][1]) {
        _teams.r32[i][1] = getGroupTeam(m.t2g, m.t2p);
      }
    }

    // Cascade: R32 → R16 uses special feed-in mapping
    for (let i = 0; i < _teams.r16.length; i++) {
      for (let j = 0; j < 2; j++) {
        const winner = getWinner('r32', R32_TO_R16[i * 2 + j]);
        // §5.2 — Invalidate explicit pick if the upstream winner changed.
        // Surface the clearing via a toast so users notice their later-phase
        // pick was wiped by an earlier-phase edit.
        if (_picks.r16[i][j] && _teams.r16[i][j] !== winner) {
          if (!_cascadeClearedThisTick) {
            _cascadeClearedThisTick = true;
            showToast('ℹ️ Picks de fases posteriores se han recalculado');
          }
          _picks.r16[i][0] = false;
          _picks.r16[i][1] = false;
        }
        _teams.r16[i][j] = _picks.r16[i][j] ? _teams.r16[i][j] : winner;
      }
    }
```

### §5.4 — Make `QF_TO_SF` explicit

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

**Old code** (lines 324-339 inside `recascade`):
```svelte
    const cascades = [
      { from: 'qf', to: 'sf' },
      { from: 'sf', to: 'final' },
    ];
    for (const { from, to } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          const winner = getWinner(from, i * 2 + j);
          if (_picks[to][i][j] && _teams[to][i][j] !== winner) {
            _picks[to][i][0] = false;
            _picks[to][i][1] = false;
          }
          _teams[to][i][j] = _picks[to][i][j] ? _teams[to][i][j] : winner;
        }
      }
    }
```

**New code**:
```svelte
    // §5.4 — Make the QF→SF and SF→Final mappings explicit. They are
    // intentionally sequential pair-of-two (mirroring the FIFA bracket)
    // but the intent should not be buried inside `i*2+j`.
    const QF_TO_SF = [0, 1, 2, 3]; // SF[i] = (QF[i*2], QF[i*2+1])
    const SF_TO_FINAL = [0, 1];    // Final[0] = (SF[0], SF[1])
    const cascades = [
      { from: 'qf', to: 'sf', map: QF_TO_SF },
      { from: 'sf', to: 'final', map: SF_TO_FINAL },
    ];
    for (const { from, to, map } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          const winner = getWinner(from, map[i * 2 + j]);
          if (_picks[to][i][j] && _teams[to][i][j] !== winner) {
            _picks[to][i][0] = false;
            _picks[to][i][1] = false;
          }
          _teams[to][i][j] = _picks[to][i][j] ? _teams[to][i][j] : winner;
        }
      }
    }
```

### §5.6 — Wildcard sentinel constant

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

Insert at the top of the script block (just before `R32_MAP`):

**Old code** (line 13):
```svelte
  const R32_MAP = [
```

**New code**:
```svelte
  // §5.6 — Sentinel for wildcard R32 group entries (3rd-place teams that
  // are determined post-group-stage). Use this everywhere instead of the
  // bare '?' string literal so typos surface at compile time.
  const WILDCARD = '?';
  const R32_MAP = [
```

Replace every `t2g === '?'` / `t2g: '?'` / `t1g === '?'` literal with the
constant. There are 6 hits in this file — search-and-replace `=== '?'` →
`=== WILDCARD` and `: '?'` (within the R32_MAP table) → `: WILDCARD`. Verify
manually that no unrelated `'?'` strings (e.g. CSS selectors or labels) are
affected.

### §5.5 — `THIRD_GROUP_MAP` integration test

Out-of-scope: requires a test harness. Documented in the audit; no code
change needed beyond §5.6 + §5.4 cleanups. Add a `// TODO: integration test`
comment above `THIRD_GROUP_MAP`:

**File**: `src/routes/pool/[id]/bracket/+page.svelte`

**Old code** (lines 90-91):
```svelte
  // Map each R32 "3rd from" slot to the groups whose 3rd-place teams feed into it
  const THIRD_GROUP_MAP = {
```

**New code**:
```svelte
  // Map each R32 "3rd from" slot to the groups whose 3rd-place teams feed into it.
  // §5.5 — Keys here MUST stay in lockstep with R32_MAP — if you reorder R32_MAP,
  // also update these keys. TODO: add an integration test that asserts every
  // wildcard slot in R32_MAP has a matching THIRD_GROUP_MAP entry.
  const THIRD_GROUP_MAP = {
```

---

## §6 — Deployment & ops

### §6.4 + §6.5 — `/api/health` exposes pool + cache + audit metrics

**File**: `src/routes/api/health/+server.ts`

**Old code** (lines 1-13):
```ts
import { json } from '@sveltejs/kit';
import { getPool } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		await getPool().query('SELECT 1');
		return json({ status: 'ok', db: true });
	} catch (e) {
		console.error('[health] DB check failed:', e);
		return json({ status: 'error', db: false }, { status: 503 });
	}
};
```

**New code**:
```ts
import { json } from '@sveltejs/kit';
import { getPool } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';
import { auditFailureCount } from '$lib/server/audit.js';
import { getCacheStats } from '$lib/server/cache.js';

export const GET: RequestHandler = async () => {
	try {
		const pgPool = getPool();
		await pgPool.query('SELECT 1');
		// §6.4 + §6.5 — Expose pool / cache / audit metrics so ops can alert
		// without scraping logs.
		return json({
			status: 'ok',
			db: true,
			pool: {
				total: pgPool.totalCount,
				idle: pgPool.idleCount,
				waiting: pgPool.waitingCount,
			},
			cache: getCacheStats(),
			audit: { failureCount: auditFailureCount.value },
		});
	} catch (e) {
		console.error('[health] DB check failed:', e);
		return json({ status: 'error', db: false }, { status: 503 });
	}
};
```

And add the `getCacheStats` helper in `src/lib/server/cache.ts`. Append after
the existing exports:

```ts
// §6.5 — Surface cache occupancy for /api/health.
export function getCacheStats(): {
	sessions: number;
	poolLeaderboard: number;
	poolResults: number;
	teams: number;
} {
	return {
		sessions: _sessionCache.size,
		poolLeaderboard: _poolLeaderboard.size,
		poolResults: _poolResults.size,
		teams: _teams?.length ?? 0,
	};
}
```

---

## §7 — Code quality

### §7.1 — `as any` casts on DB rows

Out-of-scope for this audit pass (it touches every loader and admin route).
Leave it on the backlog; document in a follow-up PR.

### §7.2 — Run forbidden-key check unconditionally

**File**: `src/lib/server/cache.ts`

**Old code** (lines 139-148):
```ts
export function setCachedPoolResults(poolId: number, data: any): void {
	if (process.env.NODE_ENV !== 'production') {
		const forbidden = ['userId', 'prediction_id', 'predictions', 'userGroupPreds', 'userBracketPreds'];
		for (const key of forbidden) {
			if (key in (data as Record<string, unknown>)) {
				throw new Error(`[cache] setCachedPoolResults must not contain user-scoped key: ${key}`);
			}
		}
	}
	_poolResults.set(poolId, { data, expiresAt: Date.now() + POOL_RESULTS_TTL });
}
```

**New code**:
```ts
export function setCachedPoolResults(poolId: number, data: any): void {
	// §7.2 — Run unconditionally; throwing on a real regression in production
	// is cheap and the only way to catch the misuse before users see leaked data.
	const forbidden = ['userId', 'prediction_id', 'predictions', 'userGroupPreds', 'userBracketPreds'];
	for (const key of forbidden) {
		if (key in (data as Record<string, unknown>)) {
			throw new Error(`[cache] setCachedPoolResults must not contain user-scoped key: ${key}`);
		}
	}
	_poolResults.set(poolId, { data, expiresAt: Date.now() + POOL_RESULTS_TTL });
}
```

### §7.3 — Case-insensitive label match

**File**: `src/routes/pool/[id]/predict/+page.server.ts`

**Old code** (line 54):
```ts
	const selectedPrediction = predictions.find(p => p.label === selectedLabel) ?? predictions[0];
```

**New code**:
```ts
	// §7.3 — Match labels case-insensitively to mirror the /api/predictions/group
	// uppercase normalization. Two entries differing only in case would otherwise
	// be unselectable.
	const selectedNorm = selectedLabel?.toLowerCase() ?? '';
	const selectedPrediction = predictions.find(p => (p.label ?? '').toLowerCase() === selectedNorm) ?? predictions[0];
```

**File**: `src/routes/pool/[id]/bracket/+page.server.ts`

**Old code** (line 39):
```ts
	const selectedPrediction = predictions.find(p => p.label === selectedLabel) ?? predictions[0];
```

**New code**:
```ts
	// §7.3 — see predict/+page.server.ts for rationale.
	const selectedNorm = selectedLabel?.toLowerCase() ?? '';
	const selectedPrediction = predictions.find(p => (p.label ?? '').toLowerCase() === selectedNorm) ?? predictions[0];
```

> If line numbers shift after other edits, locate the literal `find(p => p.label === selectedLabel)` in each file.

### §7.5 — Standardise admin catch blocks with `errCode()`

Already applied per-file under §1.x, §2.x, §3.x. The remaining file is
`src/routes/api/pools/+server.ts` line 42 — verify it already uses `errCode()`
(per the audit it does not yet).

### §7.6 — `migrate.ts` async file read

Acceptable as-is — `migrate.ts` runs once at startup, blocking is fine. Add
a comment per audit note:

**File**: `src/lib/server/migrate.ts`

**Old code** (line 70):
```ts
				const sql = readFileSync(fullPath, 'utf-8');
```

**New code**:
```ts
				// §7.6 — Synchronous read intentional: migrate is a one-shot startup
				// script, so blocking the event loop here is fine.
				const sql = readFileSync(fullPath, 'utf-8');
```

### §7.7 — Standings helper

Out-of-scope for this PR (touches three loaders + scoring.ts). Track as
follow-up: extract `buildGroupStandings(matches)` into `src/lib/server/group-standings.ts`
and have all three callers use it. §2.3 above already centralises the H2H
logic in `scoring.ts`; replicate the same logic in the standings helper.

---

## §8 — Test plan checklist (verify after applying)

- [ ] Demote an admin while their session is cached → next admin POST 403s within ~1s, not 60s.
- [ ] Reset a user's password → their browser session becomes invalid within ~1s.
- [ ] Change own password → other-device sessions die within ~1s.
- [ ] POST `/api/predictions/group` with `{prediction_id: 1}` (no groups) → 400, not 500.
- [ ] POST `/api/auth/register` with body `null` → 400, not 500.
- [ ] POST `/api/predictions/tiebreaker` with `{prediction_id, home_score: 2, away_score: null}` → 400, not silent delete.
- [ ] Site admin can hit `/api/admin/scoring` GET/POST on a pool they didn't create → 200.
- [ ] POST `/api/admin/payment` with `has_paid: "no"` → row not updated to true.
- [ ] POST `/api/admin/payment` with cross-pool `entry_id` → 404.
- [ ] Generate a new invite code (24 chars) and join via `/join/:code` → success.
- [ ] Bracket payload picking the same team twice in a phase → 400.
- [ ] Admin recalculate → leaderboard view updates immediately.
- [ ] Match-scores POST with one started match + others → 200, dropped list contains the started match, others save.
- [ ] Bracket save after group match finished → user sees points update without admin sync.
- [ ] Switch bracket entry → no flash white, last pick saved.
- [ ] Predict page: type a score, simulate navigation invalidate → score is preserved.
- [ ] /api/health → returns pool/cache/audit metrics.

End of FIX-PLAN.
