# World Cup Pool — LOW Severity Fix Plan

**Source audit:** End-to-End User Flow Audit #2  
**Date:** 2026-05-27  
**Scope:** B1-2, B1-3, B3-3, B3-4, B3-5, B4-6, B5-4, B6-5, B6-6, B7-3  
**Indentation:** tabs everywhere  
**User-facing strings:** Spanish  

---

## Dependency Graph

```
B1-2   (hooks.server.ts)          — independent
B1-3   (auth/[action]/+server.ts) — independent
B3-3   (pools/join/+server.ts)    — independent
B3-5   (pools/join/+server.ts)    — DEPENDS ON B3-3 (same file, apply after)
         (types.ts)               — prerequisite for B3-5
B3-4   (join/[code]/+page.svelte) — independent
B4-6   (predictions/group/+server.ts) — independent
B5-4   (bracket/+page.svelte)     — independent
B6-5   (scoring.ts)               — independent
B6-6   (scoring.ts)               — SKIP (see below)
B7-3   (admin/payment/+server.ts) — independent
```

**Apply order:** B1-2 → B1-3 → B3-3 → B3-5 (types.ts first) → B3-4 → B4-6 → B5-4 → B6-5 → B7-3

---

## Fix 1 — B1-2: Redirect already-authenticated users at /login

**File:** `src/hooks.server.ts`  
**Risk:** Low — one-line guard, does not touch auth logic.  

### Current code (lines 36–39)

```typescript
	}

	if (publicPaths.some(p => path.startsWith(p))) return resolve(event);
	if (path.startsWith('/_app') || path.includes('.')) return resolve(event);
```

### New code

Insert three lines **between the closing `}` of the `if (token)` block (line 36) and the public-paths guard (line 38)**:

```typescript
	}

	// B1-2: Si el usuario ya está autenticado y visita /login, redirigir al inicio
	if (event.locals.user && path === '/login') {
		throw redirect(302, '/');
	}

	if (publicPaths.some(p => path.startsWith(p))) return resolve(event);
	if (path.startsWith('/_app') || path.includes('.')) return resolve(event);
```

### Why this exact location

The `redirect` import is already present on line 1. The check must come **after** `event.locals.user` is populated (lines 13–36) and **before** the `publicPaths` early-return that would otherwise skip all further logic.

---

## Fix 2 — B1-3: Document per-process rate-limiter limitation

**File:** `src/routes/api/auth/[action]/+server.ts`  
**Risk:** Zero — comment only, no logic change.  

### Current code (line 4)

```typescript
const _attempts = new Map<string, { count: number; resetAt: number }>();
```

### New code

```typescript
// NOTA (B1-3): Este Map reside en la memoria del proceso. Con múltiples instancias del
// servidor (réplicas de Railway, funciones serverless de Vercel) cada instancia lleva su
// propio contador y el límite de 10 intentos puede eludirse rotando entre instancias.
// Para un límite compartido entre procesos se necesitaría Redis o una tabla PostgreSQL
// (p. ej. auth_rate_limits). Asumimos una sola instancia; si se escala horizontalmente,
// este limitador deberá migrarse a un almacén compartido.
const _attempts = new Map<string, { count: number; resetAt: number }>();
```

---

## Fix 3 — B3-3: Validate invite code format before DB query

**File:** `src/routes/api/pools/join/+server.ts`  
**Risk:** Low — rejects invalid strings earlier; legitimate codes (16-char uppercase base64url) still pass.  

### Invite code format

`generateInviteCode()` in `queries.ts:28` produces:

```typescript
crypto.randomBytes(16).toString('base64url').slice(0, 16).toUpperCase()
```

→ exactly **16 characters** from the set `[A-Z0-9_-]`.

### Current code (lines 11–14)

```typescript
		const { code } = await request.json();
		if (!code) return json({ error: 'Código requerido' }, { status: 400 });

		const pool = await getPoolByInvite(code.toUpperCase());
```

### New code

```typescript
		const { code } = await request.json();
		if (!code || typeof code !== 'string') return json({ error: 'Código requerido' }, { status: 400 });
		// B3-3: Validar formato del código antes de consultar la BD (16 chars base64url)
		if (!/^[A-Za-z0-9_-]{16}$/.test(code)) {
			return json({ error: 'Código de invitación inválido' }, { status: 400 });
		}

		const pool = await getPoolByInvite(code.toUpperCase());
```

**Note:** The regex is case-insensitive at input (`[A-Za-z0-9_-]`) because users may paste lowercase codes from URLs; `.toUpperCase()` normalises before the DB query as before.

---

## Fix 4 — B3-5: Reject joins to deactivated pools

**Prerequisite:** Apply Fix 3 first (same file). Also update `src/lib/server/types.ts` (step 4a) before editing the server handler (step 4b).

### Step 4a — Add `is_active` to Pool interface

**File:** `src/lib/server/types.ts`  
**Risk:** Zero — additive type change only.  

#### Current code (lines 11–25)

```typescript
export interface Pool {
	id: number;
	name: string;
	invite_code: string;
	share_token: string;
	created_by: number;
	buy_in: number;
	allow_multiple: boolean;
	deadline_group: Date | null;
	deadline_knockout: Date | null;
	status: string;
	last_scored_at: Date | null;
	last_score_error: string | null;
	created_at: Date;
}
```

#### New code

```typescript
export interface Pool {
	id: number;
	name: string;
	invite_code: string;
	share_token: string;
	created_by: number;
	buy_in: number;
	allow_multiple: boolean;
	is_active: boolean;          // B3-5: campo presente en la BD pero faltaba en el tipo
	deadline_group: Date | null;
	deadline_knockout: Date | null;
	status: string;
	last_scored_at: Date | null;
	last_score_error: string | null;
	created_at: Date;
}
```

### Step 4b — Add active-status check in join handler

**File:** `src/routes/api/pools/join/+server.ts`  
**Risk:** Low — adds a 403 path that previously fell through silently.  

#### Current code (lines 14–15, after Fix 3 adds 3 lines these become ~lines 17–18)

The old logic directly after the `getPoolByInvite` call:

```typescript
		const pool = await getPoolByInvite(code.toUpperCase());
		if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });
```

#### New code (replaces the two lines above)

```typescript
		const pool = await getPoolByInvite(code.toUpperCase());
		if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });
		// B3-5: Impedir unirse a quinielas desactivadas
		if (pool.is_active === false) {
			return json({ error: 'Esta quiniela ya no está activa' }, { status: 403 });
		}
```

---

## Fix 5 — B3-4: Prevent double-fire of auto-join `$effect`

**File:** `src/routes/join/[code]/+page.svelte`  
**Risk:** Low — eliminates fake `Event('auto')` and guards re-entry; functional outcome is identical.  

### Problem recap

1. `handleJoin(new Event('auto'))` calls `e.preventDefault()` on a fake event — semantically incorrect.  
2. If Svelte re-runs the `$effect` before `loading` flips to `true` (possible during SSR hydration reconciliation), two concurrent POST requests are sent.

### Current code (lines 32–37)

```javascript
	// Auto-join on load
	$effect(() => {
		if (data.code && !loading && !joined && !error) {
			handleJoin(new Event('auto'));
		}
	});
```

### New code

Replace the block above (including the comment) with:

```javascript
	// Auto-join on load — bandera de un solo disparo para evitar doble envío en hidratación SSR
	let _autoFired = false;
	$effect(() => {
		if (data.code && !loading && !joined && !error && !_autoFired) {
			_autoFired = true;
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
		}
	});
```

**What changed:**  
- `_autoFired` is a plain (non-reactive) variable declared in component scope. It is set to `true` synchronously before the async fetch, so any re-run of the effect within the same tick is blocked.  
- The fetch logic is inlined directly; `handleJoin` is no longer called from the `$effect`, so there is no fake event object. The form `handleJoin` function (used by the manual submit button) is left untouched.  

---

## Fix 6 — B4-6: Warn on partial group predictions (fewer than 4 positions)

**File:** `src/routes/api/predictions/group/+server.ts`  
**Risk:** Low — success path only; does not reject saves, only annotates the response.  

**Design note:** Blocking partial saves would break UX because auto-save fires while the user is still filling out positions. This fix adds a non-blocking `advertencia` field to the JSON response. A follow-up UX task would surface this warning in the UI (e.g., a toast or inline hint).

### Current code (lines 170–171, inside the transaction `try` block)

```typescript
		await client.query('COMMIT');
		return json({ ok: true });
```

### New code

```typescript
		await client.query('COMMIT');

		// B4-6: Detectar grupos guardados con posiciones incompletas (1-3 de 4)
		const partialGroups = Object.entries(groups)
			.filter(([, positions]) => {
				const filled = [positions.pos1, positions.pos2, positions.pos3, positions.pos4]
					.filter((v) => v != null);
				return filled.length > 0 && filled.length < 4;
			})
			.map(([g]) => g);

		return json({
			ok: true,
			...(partialGroups.length > 0
				? { advertencia: `Grupos con predicción incompleta: ${partialGroups.join(', ')}` }
				: {}),
		});
```

**No client changes required** for this fix — the `advertencia` field is silently ignored by the current client. A separate task should add a UI toast or indicator.

---

## Fix 7 — B5-4: Remove arbitrary fallback teams from bracket R32 slots

**File:** `src/routes/pool/[id]/bracket/+page.svelte`  
**Risk:** Low — slots without group predictions will show "—" (empty) instead of misleading placeholder teams. The existing warning banner already guides users to fill their groups.  

### Part A — Remove the alphabetical fallback in `getGroupTeam` (lines 146–156)

#### Current code

```javascript
	function getGroupTeam(group, pos) {
		const gp = data.groupPredictions?.[group];
		if (gp) {
			const id = [gp.pos1, gp.pos2, gp.pos3, gp.pos4][pos - 1];
			if (id) return id;
		}
		// Fallback: use default team order from teamsByGroup
		const gTeams = data.teamsByGroup?.[group];
		if (gTeams && gTeams.length >= pos) return gTeams[pos - 1].id;
		return null;
	}
```

#### New code

```javascript
	function getGroupTeam(group, pos) {
		const gp = data.groupPredictions?.[group];
		if (gp) {
			const id = [gp.pos1, gp.pos2, gp.pos3, gp.pos4][pos - 1];
			if (id) return id;
		}
		// B5-4: Sin relleno automático — devolver null para que el hueco aparezca como TBD
		// y no confundir al usuario con equipos aleatorios.
		return null;
	}
```

### Part B — Update the incomplete-groups banner text (line 592)

The banner previously told users "usando orden por defecto" which is no longer accurate.

#### Current code (line 592)

```svelte
			<span>⚠️ Grupos incompletos ({groupsPredicted}/12) — usando orden por defecto para los no rellenados.</span>
```

#### New code

```svelte
			<span>⚠️ Grupos incompletos ({groupsPredicted}/12) — los cruces sin predicción de grupo aparecerán como TBD.</span>
```

---

## Fix 8 — B6-5: Make `calculateGroupScores` idempotent (reset before recalculate)

**File:** `src/lib/server/scoring.ts`  
**Risk:** Low — the reset runs inside the same transaction as the recalculation; it only zeroes rows that will immediately be overwritten with the correct value (or left at 0 if no finished match exists for that group).  

### Problem recap

When an admin reverts a match from `finished` to `scheduled` (directly in the DB — no UI, but possible), `actualPositions[group]` is no longer built for that group, so the `if (!actual) continue` guard skips it and leaves stale `points_earned` values on `group_predictions` rows.

### Current code (lines 83–89)

```typescript
	// Collect (prediction_id, group_name, points) for bulk unnest UPDATE
	const predIds: number[] = [];
	const groupNames: string[] = [];
	const ptsArray: number[] = [];

	for (const gp of allGP) {
		const actual = actualPositions[gp.group_name];
```

### New code

Insert a reset query after the array declarations and before the loop:

```typescript
	// Collect (prediction_id, group_name, points) for bulk unnest UPDATE
	const predIds: number[] = [];
	const groupNames: string[] = [];
	const ptsArray: number[] = [];

	// B6-5: Poner a cero todos los puntos de grupo antes de recalcular para que la función
	// sea idempotente aunque un resultado se revierta de 'finished' a 'scheduled'.
	await client.query(`
		UPDATE group_predictions gp
		SET points_earned = 0
		FROM predictions p
		WHERE p.id = gp.prediction_id
		  AND p.pool_id = $1
	`, [poolId]);

	for (const gp of allGP) {
		const actual = actualPositions[gp.group_name];
```

---

## Fix 9 — B6-6: FIFA head-to-head tiebreaker — **SKIP**

**Status:** ⛔ SKIP — too complex for a LOW-severity fix; requires design input.

### Why skip

FIFA's official group-stage tiebreaker order is:

1. Points overall  
2. Head-to-head points (among tied teams only)  
3. Head-to-head goal difference  
4. Head-to-head goals scored  
5. Goal difference overall  
6. Goals scored overall  
7. FIFA ranking (data not stored)

Implementing steps 2–4 correctly requires:

- Identifying every subset of teams that are tied on points at the end of the group stage (can be 2, 3, or 4 teams).  
- For each subset, scanning the already-loaded `matches` array for matches played **between only those teams**, building mini-standings, then re-sorting.  
- If the mini-standings are again tied (e.g., a 3-way cycle: A beat B, B beat C, C beat A), dropping down to overall GD/GF — a recursive fall-through.  
- The algorithm branches combinatorially for groups with 3–4 teams at identical points.

This is ~60–80 lines of complex algorithmic code with multiple edge cases. It also affects scoring correctness (not just display), so it deserves its own focused PR with test cases.

### Recommended follow-up

1. Add a comment to `scoring.ts` lines 66–70 acknowledging the limitation:

```typescript
	// TODO (B6-6): La clasificación usa puntos → dif. de goles → goles a favor.
	// El desempate oficial de la FIFA incluye resultados directos entre los equipos empatados
	// antes de aplicar las diferencias globales. Implementar desempate H2H requiere
	// una PR dedicada con casos de prueba para ciclos de 3/4 equipos.
	const sorted = Object.entries(teams)
		.map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga }))
		.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
```

2. Open a separate ticket with the full algorithm spec before implementation.

---

## Fix 10 — B7-3: Allow site-wide admins to manage payments for any pool

**File:** `src/routes/api/admin/payment/+server.ts`  
**Risk:** Low — adds a permission path for users already marked `is_admin`; does not loosen pool-creator checks.  

### Current code (lines 19–23)

```typescript
		const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
		const pool = poolRows[0] ?? null;
		if (!pool || pool.created_by !== locals.user.id) {
			return json({ error: 'Prohibido' }, { status: 403 });
		}
```

### New code

```typescript
		const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
		const pool = poolRows[0] ?? null;
		// B7-3: El creador de la quiniela O el admin del sitio pueden gestionar pagos
		if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
			return json({ error: 'Prohibido' }, { status: 403 });
		}
```

**Type note:** `locals.user.is_admin` is declared as `number` in `src/app.d.ts:8` (legacy SQLite typing), but the PostgreSQL driver returns it as a JS `boolean`. Using `!locals.user.is_admin` (falsy check) handles both `false` and `0` safely. If the `app.d.ts` type is corrected to `boolean` in a separate cleanup, no change is needed here.

---

## Summary Table

| # | ID | File(s) | Lines affected | Action |
|---|---|---|---|---|
| 1 | B1-2 | `src/hooks.server.ts` | Insert after line 36 | Redirect `/login` → `/` when user already authenticated |
| 2 | B1-3 | `src/routes/api/auth/[action]/+server.ts` | Line 4 | Add explanatory comment above `_attempts` Map |
| 3 | B3-3 | `src/routes/api/pools/join/+server.ts` | Lines 11–14 | Add regex format check before DB query |
| 4 | B3-5 | `src/lib/server/types.ts` + `join/+server.ts` | types:18, join:17–18 | Add `is_active` to Pool type; reject inactive pools |
| 5 | B3-4 | `src/routes/join/[code]/+page.svelte` | Lines 32–37 | Replace `$effect` with guarded inline fetch |
| 6 | B4-6 | `src/routes/api/predictions/group/+server.ts` | Lines 170–171 | Return `advertencia` field for partial groups (non-blocking) |
| 7 | B5-4 | `src/routes/pool/[id]/bracket/+page.svelte` | Lines 146–156, 592 | Remove arbitrary fallback; update banner text |
| 8 | B6-5 | `src/lib/server/scoring.ts` | After line 86 | Add reset query before recalculation loop |
| 9 | B6-6 | `src/lib/server/scoring.ts` | Lines 66–70 | **SKIP** — add TODO comment only |
| 10 | B7-3 | `src/routes/api/admin/payment/+server.ts` | Line 21 | Allow site-wide admins to toggle any pool's payments |
