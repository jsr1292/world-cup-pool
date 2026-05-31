# Mundial 2026 — Quiniela (World Cup Pool)

A private prediction pool for the FIFA World Cup 2026. Friends create or join a
pool and predict group standings, individual match scores, and the knockout
bracket; an admin enters real results and the app scores everyone automatically.
Spanish-language UI.

## Tech stack

- **SvelteKit 2 / Svelte 5** (runes), TypeScript, **Tailwind CSS 4**, Vite
- **PostgreSQL** via `pg` (raw SQL; hand-written migrations — no ORM at runtime)
- **`@sveltejs/adapter-node`** — deploys as a standalone Node server
- Auth: server-side sessions + `scrypt` password hashing

---

## Prerequisites

- **Node.js ≥ 20.12** (uses the built-in `.env` loader; developed on Node 25)
- A **PostgreSQL** database. [Neon](https://neon.tech) works out of the box
  (the SSL config expects a managed provider; for a local Postgres, use a
  `localhost` connection string and SSL is disabled automatically).

---

## Quick start (local)

```sh
# 1. Install dependencies
npm install

# 2. Create .env with your database URL (this file is gitignored — never commit it)
cat > .env <<'EOF'
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
EOF

# 3. One-shot DB setup: migrations + 48 teams + 104 match fixtures
npm run setup

# 4. Run the dev server (http://localhost:3470)
npm run dev
```

`npm run setup` runs `migrate` → `seed` (teams) → `seed:matches` (fixtures) in
order. The CLI scripts **auto-load `.env`** from the project root, so you don't
need to export anything. (If you prefer, you can still export `DATABASE_URL` in
your shell — an exported value always takes precedence over `.env`.)

After setup the database has: the full schema, **48 teams in 12 groups (A–L)**,
and **104 matches** (72 group-stage round-robin + 32 knockout placeholders).

### Become the first admin

There is no UI to grant admin. Register a normal account in the app, then flip
the flag directly in the database:

```sql
UPDATE users SET is_admin = true WHERE username = 'your_username';
```

Admins can enter match results, manage scoring rules and deadlines, and access
`/admin` and each pool's admin page. Log out and back in after the change.

### Lock down who can create pools

Pool creation is governed by the `can_create_pools` site setting. Default is
`admin` (only admins / whitelisted users). To restrict it (recommended for a
private pool):

```sql
UPDATE site_settings SET value = 'admin' WHERE key = 'can_create_pools';
-- 'anyone' lets any registered user create a pool.
```

> Note: account **registration is always open** — anyone who can reach the URL
> can sign up. Keep the deployment URL private among your group.

---

## Production deployment

This app builds to a Node server via `adapter-node`.

```sh
npm install
npm run setup          # once, against your production DATABASE_URL
npm run build
NODE_ENV=production node build/index.js   # or: npm run start
```

### Required environment variables

| Variable        | Required        | Purpose |
|-----------------|-----------------|---------|
| `DATABASE_URL`  | **yes**         | PostgreSQL connection string. |
| `NODE_ENV`      | **yes (prod)**  | Set to `production`. Enables `Secure` session cookies and stricter cross-origin checks. |
| `PORT`          | no (default 3000) | Port for the Node server (adapter-node). |
| `HOST`          | no (default 0.0.0.0) | Bind address. |
| `API_FOOTBALL_KEY` | no           | Optional live-score provider key. Live sync is otherwise disabled (see below). |

> In production, set these as real environment variables on your host — do
> **not** ship a `.env` file. There is no `.env` in the deployed build.

### ⚠️ HTTPS is required in production

Session cookies are issued with the `Secure` flag whenever `NODE_ENV` is not
`development`. Browsers will not store `Secure` cookies over plain HTTP, so
**login will silently fail unless the app is served over HTTPS** (terminate TLS
at your host/reverse proxy, which is automatic on most platforms).

---

## Entering results & scoring

- **Group stage:** open a pool's **admin page** and enter each match's score.
  Saving a result recomputes scores for all active pools automatically
  (group-position points, match outcome/exact-score points).
- **Knockout stage:** knockout matches are seeded as placeholders with no teams,
  because the matchups aren't known until the group stage finishes. Set a
  knockout match's teams **and** score via the results API (the admin panel UI
  for picking knockout teams is a planned follow-up):

  ```sh
  POST /api/admin/results
  { "match_id": 208, "home_team_id": 2, "away_team_id": 5,
    "home_score": 1, "away_score": 0, "penalty_winner_id": null }
  ```

  `penalty_winner_id` is only used for knockout draws decided on penalties.
- **Prediction deadlines:** set per-pool `deadline_group` / `deadline_knockout`
  on the pool admin page to control when predictions lock. (Match `kickoff_time`
  is left NULL by the seeder since the official 2026 kickoff schedule isn't
  embedded; pool-level deadlines govern locking until those times are filled in.)

> **Live-score sync is deferred.** Automated result ingestion (FIFA / API-Football)
> is stubbed pending the 2026 tournament API. Until then, enter results manually
> as above.

---

## npm scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server on port 3470. |
| `npm run build` / `npm run start` | Production build / run the built server. |
| `npm run setup` | `migrate` + `seed` + `seed:matches` (full fresh-DB setup). |
| `npm run migrate` | Apply pending SQL migrations (`drizzle/migrations/*.sql`). |
| `npm run seed` | Seed the 48 teams / 12 groups (idempotent upsert). |
| `npm run seed:matches` | Seed the 104 fixtures. Idempotent; `-- --force` wipes and reseeds. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:watch` | Unit tests in watch mode. |

### Integration tests

A separate suite exercises real SQL against a Postgres database (each test runs
in a rolled-back transaction). Point it at a **dedicated test database**:

```sh
TEST_DATABASE_URL="postgresql://..." \
  npx vitest run --config vitest.integration.config.ts
```
