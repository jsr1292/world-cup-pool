# World Cup Pool — Implementation Plan (26 Findings)

> Audited by Claude Code (Sonnet 4), $0.66
> Fixes to be applied via parallel delegation.

---

## Phase 1 — Security (7 findings + L3)

### H1 · `src/routes/leaderboard/+page.server.ts:15–19`
SQL injection via string interpolation of DB values into SQL.
```typescript
const h = Math.trunc(Number(finalMatch.home_score));
const a = Math.trunc(Number(finalMatch.away_score));
orderByTiebreaker = `(
  COALESCE(ABS(tb.home_score - ${h}) + ABS(tb.away_score - ${a}), 9999)
)`;
```

### H4 · `src/routes/api/predictions/entry/+server.ts:14–15`
No pool membership check. Add after pool fetch:
```typescript
const member = db
  .prepare('SELECT 1 FROM pool_members WHERE pool_id = ? AND user_id = ?')
  .get(pool_id, locals.user.id);
if (!member) return json({ error: 'No eres miembro de esta quiniela' }, { status: 403 });
```

### H5 · `src/lib/server/live-scores.ts:146`
Fuzzy match uses OR → AND:
```sql
WHERE (t1.name LIKE ? ESCAPE '\' AND t2.name LIKE ? ESCAPE '\')
  AND m.status != 'finished'
```

### H7 + L3 · `src/routes/api/auth/[action]/+server.ts`
Add rate limiter + fix action parsing:
```typescript
const _attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 15 * 60 * 1000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const e = _attempts.get(ip);
  if (!e || now > e.resetAt) { _attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

export const POST: RequestHandler = async ({ request, cookies, params, getClientAddress }) => {
  const action = params.action; // fixes L3
  if ((action === 'login' || action === 'register') && !checkRate(getClientAddress())) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }
```

### M1 · `src/lib/server/queries.ts:17`
Non-constant-time comparison:
```typescript
return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
```

### M2 · `src/routes/api/auth/[action]/+server.ts:32,50`
Secure cookies:
```typescript
secure: process.env.NODE_ENV === 'production',
```

### M3 · `src/routes/api/admin/results/+server.ts:8–22`
Replace pool-owner check with admin check:
```typescript
const actor = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
if (!actor?.is_admin) {
  return json({ error: 'Solo los administradores pueden modificar resultados' }, { status: 403 });
}
```

### M8 · `src/lib/server/backup.ts:29`
Sanitize backup label:
```typescript
const safeLabel = (label || 'manual').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'manual';
const backupName = `pool-${getTimestamp()}-${safeLabel}.db`;
```

---

## Phase 2 — Scoring Bugs (5 findings)

### H2 · `src/lib/server/queries.ts:68–78`
Add `third_place` to createPool defaults (after `knockout_final`):
```typescript
['third_place', 25],
```

### H3 · `src/lib/server/scoring.ts:150–155`
Award knockout_winner bonus when champion predicted correctly:
```typescript
const ruleKey = bp.phase === '3rd' ? 'third_place' : `knockout_${bp.phase}`;
let pts = rules[ruleKey] ?? 0;
if (bp.phase === 'final') {
  pts += rules['knockout_winner'] ?? 0;
}
updateBP.run(pts, pred.id, bp.phase, bp.team_id);
```

### H6 · `src/routes/api/predictions/match-scores/+server.ts:67`
Remove duplicate `calculateMatchScores` call (line 67). `calculateAllScores` already calls it.

### M6 · `src/lib/server/scoring.ts:121–126`
Skip tied knockout matches with warning:
```typescript
if (m.home_score === m.away_score) {
  console.warn(`[scoring] Knockout match ${m.id} has equal scores — skipping`);
  continue;
}
const winner = m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
```

### L1 · `src/lib/server/scoring.ts:3–13`
Align DEFAULT_RULES to match createPool defaults:
```typescript
const DEFAULT_RULES: Record<string, number> = {
  match_outcome: 1, exact_score: 3, group_position: 2,
  knockout_r32: 2, knockout_r16: 3, knockout_qf: 4,
  knockout_sf: 6, knockout_final: 6, knockout_winner: 8,
  third_place: 25,
};
```

---

## Phase 3 — Correctness / Race Conditions (8 findings)

### M4 · `src/routes/api/predictions/match-scores/+server.ts:28–31`
Per-phase deadline check — fetch match phases and check appropriate deadline.

### M5 · `src/routes/api/auth/change-password/+server.ts`
Use shared db singleton instead of new connection. Rewrite to import `db` from `$lib/server/db.js`.

### M7 · `src/routes/api/predictions/group/+server.ts:64`
Validate team IDs belong to claimed group:
```typescript
const valid = db.prepare(
  `SELECT COUNT(*) as cnt FROM teams WHERE group_name = ? AND id IN (${placeholders})`
).get(groupName, ...filled) as any;
if (valid.cnt !== filled.length) {
  return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
}
```

### M9 · `src/routes/api/predictions/entry/+server.ts:36–37`
Guard null result:
```typescript
const result = createPrediction(pool_id, locals.user.id, label);
if (!result) return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 409 });
```

### M10 + L5 · `src/hooks.server.ts:19–20`
Probabilistic cleanup, use cleanSessions():
```typescript
import { cleanSessions } from '$lib/server/queries.js';
// ...
if (Math.random() < 0.01) cleanSessions();
```

### M11 · `src/lib/server/backup.ts:58–73`
Checkpoint + close shared db before copy:
```typescript
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
copyFileSync(backupPath, DB_PATH);
// returns { requiresRestart: true }
```

### L4 · `src/routes/pools/+page.server.ts:6`
Guard locals.user before use:
```typescript
if (!locals.user) return { pools: [], canCreate: false };
```

---

## Phase 4 — Cleanup (4 findings)

### L2 · Fixed in M5 rewrite (min 6 chars).

### L6 · `src/routes/api/admin/results/+server.ts:14–16`
Bounds check on scores:
```typescript
if (!Number.isInteger(home_score) || !Number.isInteger(away_score) ||
  home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
  return json({ error: 'Marcador inválido' }, { status: 400 });
}
```

### L7 · `src/routes/api/admin/settings/+server.ts:10`
Whitelist allowed keys:
```typescript
const ALLOWED_SETTINGS = new Set(['can_create_pools']);
if (!ALLOWED_SETTINGS.has(key)) return json({ error: 'Clave desconocida' }, { status: 400 });
```

### L8 · `src/routes/api/auth/[action]/+server.ts`
Cap display_name at 50 chars.

---

## Dependency Notes
- M5 before H7/L2/L3 — same file, rewrite first
- M6 before H3 — fix knockout draws before champion bonus
- H2 + L1 together — both touch scoring defaults
- M10 + L5 are one edit
- M11: after merge, restore requires server restart
