# World Cup Pool — SQLite → PostgreSQL Migration Plan

## Overview

Hard migration from SQLite (better-sqlite3) to PostgreSQL (raw `pg` driver).
No dual support. Neon free tier for hosting.

---

## Phase 1: Environment Setup

### New dependencies
```bash
npm install pg
npm install -D @types/pg
npm uninstall better-sqlite3 @types/better-sqlite3
```

### New files
- `.env` — `DATABASE_URL=postgresql://user:pass@host/db`
- `.env.example` — same format, placeholder values
- Add `.env` to `.gitignore`

### Local dev: Docker Postgres
```bash
docker run -d --name wc-pool-pg \
  -e POSTGRES_USER=wcpool \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=wcpool \
  -p 5432:5432 \
  postgres:16
```

---

## Phase 2: Schema Translation

### File: `drizzle/migrations/0001_initial.sql`

| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `INTEGER DEFAULT 0` (booleans) | `BOOLEAN DEFAULT FALSE` |
| `TEXT DEFAULT (datetime('now'))` | `TIMESTAMPTZ DEFAULT NOW()` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `REAL` | `NUMERIC(10,2)` |
| `?` params | `$1, $2, $3` |

### Full PostgreSQL schema:

```sql
-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_admin BOOLEAN DEFAULT FALSE
);

-- Pools
CREATE TABLE pools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  buy_in NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  is_active BOOLEAN DEFAULT TRUE,
  deadline_group TIMESTAMPTZ,
  deadline_knockout TIMESTAMPTZ,
  allow_multiple_predictions BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool members
CREATE TABLE pool_members (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  has_paid BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, user_id)
);

-- Teams
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  flag_code TEXT,
  group_name TEXT,
  fifa_rank INTEGER
);

-- Matches
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  fifa_id TEXT,
  phase TEXT NOT NULL,
  matchday INTEGER,
  group_name TEXT,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  status TEXT DEFAULT 'scheduled',
  kickoff TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0
);

-- Predictions
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  has_paid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, user_id, label)
);

-- Match predictions
CREATE TABLE match_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER,
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, match_id)
);

-- Group standings predictions
CREATE TABLE group_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  position_1 INTEGER REFERENCES teams(id),
  position_2 INTEGER REFERENCES teams(id),
  position_3 INTEGER REFERENCES teams(id),
  position_4 INTEGER REFERENCES teams(id),
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, group_name)
);

-- Knockout bracket predictions
CREATE TABLE bracket_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  slot INTEGER NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, phase, slot)
);

-- Scoring config per pool
CREATE TABLE scoring_config (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pool_id, rule)
);

-- Sessions
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tiebreaker
CREATE TABLE tiebreaker (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER
);

-- Indexes
CREATE INDEX idx_pool_members_user ON pool_members(user_id);
CREATE INDEX idx_predictions_pool ON predictions(pool_id);
CREATE INDEX idx_match_predictions_pred ON match_predictions(prediction_id);
CREATE INDEX idx_group_predictions_pred ON group_predictions(prediction_id);
CREATE INDEX idx_matches_phase ON matches(phase);
CREATE INDEX idx_bracket_predictions_pred ON bracket_predictions(prediction_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_phase_status ON matches(phase, status);
CREATE INDEX idx_pools_is_active ON pools(is_active);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Site-wide settings
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO site_settings (key, value) VALUES ('can_create_pools', 'admin');

-- Users allowed to create pools
CREATE TABLE pool_creators (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
```

---

## Phase 3: New `db.ts`

Replace the entire file. Remove SQLite pragmas, schema init, and migrations.

```typescript
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();
export { pool };
```

---

## Phase 4: `queries.ts` Conversion

### Conversion patterns

```typescript
// BEFORE (SQLite sync)                    // AFTER (Postgres async)
db.prepare('SELECT ...').get(id)           → const { rows } = await query('SELECT ...', [id]); return rows[0] ?? null;
db.prepare('SELECT ...').all(id)           → const { rows } = await query('SELECT ...', [id]); return rows;
db.prepare('INSERT ...').run(val)          → const result = await query('INSERT ...', [val]); return result;
result.lastInsertRowid                     → result.rows[0].id (use RETURNING id)
db.transaction(() => { ... })             → const client = await getClient(); try { await client.query('BEGIN'); ...; await client.query('COMMIT'); } catch { await client.query('ROLLBACK'); throw; } finally { client.release(); }
?                                          → $1, $2, $3
e.code === 'SQLITE_CONSTRAINT'            → error.code === '23505' (unique violation)
e.code?.startsWith('SQLITE_CONSTRAINT')   → error.code === '23505'
datetime('now')                           → NOW()
```

### Every function changes:

1. `createUser` → async, `RETURNING id`
2. `getUserById` → async, `rows[0] ?? null`
3. `getUserByUsername` → async, `rows[0] ?? null`
4. `authenticateUser` → async (calls async getUserByUsername)
5. `createPool` → async, transaction with `getClient()`, `RETURNING id`
6. `getPoolByInvite` → async
7. `getPoolById` → async
8. `getUserPools` → async
9. `joinPool` → async, catch `23505` instead of SQLITE_CONSTRAINT
10. `markPaid` → async, `SET has_paid = TRUE`
11. `getPoolMembers` → async
12. `createPrediction` → async, catch `23505`
13. `getUserPredictions` → async
14. `getPoolLeaderboard` → async
15. `getScoringConfig` → async
16. `createSession` → async
17. `deleteSession` → async
18. `cleanSessions` → async, `WHERE expires_at < NOW()`
19. `getAllTeams` → async (calls into cache.ts which also needs conversion)
20. `getGroupPredictions` → async

---

## Phase 5: `scoring.ts` Conversion

All 4 functions become async. Every `db.prepare().all()` → `await query()`. Transactions use `getClient()` pattern.

### Boolean awareness:
- `has_paid` comparisons: `=== 1` → `=== true` (or just truthy check)
- `is_active` comparisons: same
- `is_admin` comparisons: same

### Key changes:
- `calculateGroupScores` → async, transaction with client
- `calculateBracketScores` → async, transaction with client
- `calculateMatchScores` → async, transaction with client
- `calculateAllScores` → async, `datetime('now')` → `NOW()`

---

## Phase 6: Other server files

### `cache.ts`
- `db.prepare().get()` → `await query()` in getSessionByToken
- `db.prepare().all()` → `await query()` in getAllTeamsCached
- All exported functions become async

### `seed.ts`
- All `db.prepare().run()` → `await query()`
- Transaction → client pattern
- Named params (`@name`) → positional (`$1, $2, ...`)

### `backup.ts`
- Remove SQLite `VACUUM INTO` logic
- Replace with `pg_dump` command or remove entirely (Neon handles backups)

### `live-scores.ts`
- All `db.prepare().get()` / `.all()` / `.run()` → async `query()`
- `datetime('now')` → `NOW()`

---

## Phase 7: Route files (add `await`)

Every route file that calls functions from `queries.ts` needs `await` added.
Since all query functions become async, every call site needs updating.

### Files to modify (19 files):

1. `src/hooks.server.ts` — `cleanSessions()` → `await cleanSessions()`
2. `src/routes/+page.server.ts` — `getUserPools()` → `await getUserPools()`
3. `src/routes/s/[code]/+page.server.ts` — await getPoolLeaderboard, getScoringConfig
4. `src/routes/pools/+page.server.ts` — await getUserPools
5. `src/routes/pool/[id]/+page.server.ts` — await getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions
6. `src/routes/pool/[id]/summary/+page.server.ts` — await getPoolById, getUserPredictions
7. `src/routes/pool/[id]/predict/+page.server.ts` — await getPoolById, getAllTeams, createPrediction, getUserPredictions, getGroupPredictions
8. `src/routes/pool/[id]/admin/+page.server.ts` — await getPoolById, getPoolMembers, getScoringConfig
9. `src/routes/pool/[id]/bracket/+page.server.ts` — await getPoolById, getUserPredictions, getGroupPredictions, getAllTeams
10. `src/routes/pool/[id]/results/+page.server.ts` — await getPoolById, getUserPredictions
11. `src/routes/api/admin/pool-settings/+server.ts` — await getPoolById
12. `src/routes/api/pools/+server.ts` — await createPool
13. `src/routes/api/pools/join/+server.ts` — await getPoolByInvite, joinPool
14. `src/routes/api/predictions/entry/+server.ts` — await createPrediction
15. `src/routes/api/auth/change-password/+server.ts` — await verifyPwd, hashPwd (these stay sync — crypto only, no DB)
16. `src/routes/api/auth/[action]/+server.ts` — await authenticateUser, createUser, createSession

### SvelteKit `load` functions

SvelteKit `+page.server.ts` `load` functions already support async (they're async by default). Just add `await` to each query call.

### API route handlers (`+server.ts`)

These use `export async function GET/POST/etc.` — already async. Add `await`.

---

## Phase 8: Boolean Migration Audit

Every `INTEGER DEFAULT 0` column becomes `BOOLEAN DEFAULT FALSE`.

### Columns affected:
- `users.is_admin`
- `pool_members.has_paid`
- `pools.is_active`
- `pools.allow_multiple_predictions`
- `predictions.has_paid`

### Grep targets:
- `=== 1` → `=== true` or just truthy
- `=== 0` → `=== false` or `!value`
- `SET has_paid = 1` → `SET has_paid = TRUE`
- `SET is_active = 0` → `SET is_active = FALSE`
- Any `if (user.is_admin)` → still works (truthy)
- Any `if (row.has_paid === 1)` → `if (row.has_paid === true)` or `if (row.has_paid)`

---

## Phase 9: Error Code Changes

| SQLite | PostgreSQL | Meaning |
|---|---|---|
| `SQLITE_CONSTRAINT` (unique) | `'23505'` | Unique violation |
| `SQLITE_CONSTRAINT` (fk) | `'23503'` | Foreign key violation |
| `e.code?.startsWith('SQLITE_CONSTRAINT')` | `e.code === '23505'` | Catch unique violations |

### Files with error handling:
- `queries.ts`: `joinPool` (line 116), `createPrediction` (line 147)

---

## Phase 10: Data Migration (if existing data)

If there's existing data to preserve:

```bash
# Export SQLite to CSV
sqlite3 data/pool.db ".mode csv" ".output users.csv" "SELECT * FROM users;"
sqlite3 data/pool.db ".mode csv" ".output pools.csv" "SELECT * FROM pools;"
# ... repeat for all tables

# Import into Postgres
\copy users FROM 'users.csv' WITH CSV HEADER;
\copy pools FROM 'pools.csv' WITH CSV HEADER;
# ... repeat
```

Or write a one-time Node.js script:
```javascript
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const sqlite = new Database('./data/pool.db');
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const tables = ['users', 'pools', 'pool_members', 'teams', 'matches',
    'predictions', 'match_predictions', 'group_predictions',
    'bracket_predictions', 'scoring_config', 'sessions', 'tiebreaker',
    'site_settings', 'pool_creators'];
  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    for (const row of rows) {
      const vals = cols.map(c => row[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await pg.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
    }
    console.log(`${table}: ${rows.length} rows`);
  }
}
migrate().then(() => process.exit(0));
```

---

## Phase 11: Testing Checklist

- [ ] App starts without errors
- [ ] User registration works
- [ ] User login works (session creation)
- [ ] Pool creation works (transaction with scoring config)
- [ ] Pool join works (invite code, UNIQUE constraint)
- [ ] Prediction submission works
- [ ] Group predictions save/load
- [ ] Bracket predictions save/load
- [ ] Leaderboard displays correctly
- [ ] Scoring calculation runs (match + group + bracket)
- [ ] Admin panel works
- [ ] Session cleanup runs on startup
- [ ] Live score sync works
- [ ] Boolean fields display correctly (is_admin, has_paid)
- [ ] Error handling: duplicate join returns false, not crash
- [ ] Password hashing still works (no DB change, just crypto)
- [ ] `.env` is not committed to git

---

## Effort Estimate

| Phase | Hours |
|---|---|
| Environment + dependencies | 0.5h |
| Schema translation | 1h |
| New db.ts | 0.5h |
| queries.ts async conversion | 3-4h |
| scoring.ts async conversion | 2-3h |
| cache.ts, seed.ts, live-scores.ts | 1-2h |
| Route files (19 files, add await) | 1-2h |
| Boolean audit + error codes | 1h |
| Data migration | 0.5-1h |
| Testing + debugging | 2-3h |
| **Total** | **13-18h** |

---

## Execution Order

1. Install `pg`, remove `better-sqlite3`
2. Create `.env` with `DATABASE_URL`
3. Write `0001_initial.sql` migration, run it against Postgres
4. Replace `db.ts` with pg Pool
5. Convert `queries.ts` (all functions async)
6. Convert `scoring.ts` (all functions async)
7. Convert `cache.ts`, `seed.ts`, `live-scores.ts`
8. Update all 19 route files (add await)
9. Boolean audit (grep for === 1, === 0)
10. Error code audit (SQLITE_CONSTRAINT → 23505)
11. Remove or replace `backup.ts`
12. Test everything
