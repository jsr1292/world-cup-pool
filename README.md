# Mundial 2026 — Quiniela (World Cup Pool)

A private prediction pool for the **FIFA World Cup 2026**. Friends create or join a
pool, make their predictions before kickoff, and compete on an auto-scored
leaderboard. Built to run on a Raspberry Pi as a **Home Assistant add-on** (or any
Node host) with a managed Postgres database. Spanish-language UI.

### How the game works

- **Group stage — `1 / X / 2`.** For each of the 72 group matches you pick the
  result: **1** (home win), **X** (draw) or **2** (away win) — classic quiniela.
  **+1 point per correct result.** Your picks derive a projected group table that
  feeds the knockout bracket automatically.
- **Knockout — the bracket.** Pick which team advances through each round
  (R32 → R16 → QF → SF → Final → champion, plus the best-third wildcards and the
  3rd-place match). Each correct call is worth configurable points.
- **The final score** is the one scoreline you predict — used as the **tiebreaker**
  (closest to the real result wins ties).
- An admin enters real results (manually, or via optional auto-sync) and everyone
  is re-scored instantly. Matches lock individually at kickoff (the official 2026
  schedule is built in), with an overall per-pool deadline on top.

## Tech stack

- **SvelteKit 2 / Svelte 5** (runes), TypeScript, **Tailwind CSS 4**, Vite
- **PostgreSQL** via `pg` (raw SQL; hand-written migrations — no runtime ORM)
- **`@sveltejs/adapter-node`** — builds to a standalone Node server
- Auth: server-side sessions + `scrypt` password hashing

---

## Deploy as a Home Assistant add-on (recommended)

This is the easiest path — no terminal needed after setup. Full instructions are in
**[`homeassistant-addon/README.md`](homeassistant-addon/README.md)**. In short:

1. **Get a Postgres database.** [Neon](https://neon.tech) has a free tier that works
   out of the box. Copy its connection string.
2. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
   this repo's URL, then install **World Cup Pool**.
3. Open the add-on **Configuration** and fill the form:
   - `database_url` — your Postgres connection string (**required**)
   - `node_env` — `production` (needs HTTPS; HA ingress and most reverse proxies
     provide it)
   - `admin_username` — **your email**; you're made admin automatically when you
     register
   - `run_setup` — `true` for the first boot (creates the schema + seeds 48 teams,
     104 matches and the 2026 kickoff schedule; idempotent, safe to leave on)
   - everything else is optional (see the table below)
4. **Start** the add-on. Open it via the HA sidebar (ingress) or your reverse-proxy
   URL, register your account (you become admin), create a pool, set the deadlines,
   and share the invite link.

The add-on listens on port **3000** (ingress + a mapped host port for LAN / a
DuckDNS reverse proxy).

---

## Run it yourself (any Node host)

```sh
# 1. Install dependencies
npm install

# 2. Create .env with your database URL (gitignored — never commit it)
cat > .env <<'EOF'
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
EOF

# 3. One-shot DB setup: migrations + 48 teams + 104 fixtures + kickoff schedule
npm run setup

# 4a. Dev server (http://localhost:3470)
npm run dev

# 4b. …or production build
npm run build
NODE_ENV=production node build/index.js   # or: npm run start
```

`npm run setup` runs `migrate` → `seed` (teams) → `seed:matches` (fixtures +
official 2026 kickoff times), in order, auto-loading `.env`. After it, the database
has the full schema, **48 teams in 12 groups (A–L)** and **104 matches** (72 group
round-robin + 32 knockout placeholders, whose teams fill in as the bracket resolves).

### Become admin

Set **`ADMIN_USERNAME`** (env) / **`admin_username`** (add-on config) to your email
*before* you register — you're promoted to admin automatically on sign-up (and on
every boot). No SQL needed. As a fallback you can flip the flag directly:

```sql
UPDATE users SET is_admin = true WHERE email = 'you@example.com';
```

Admins manage scoring rules and deadlines, enter results, reset a user's password
(handy when email is off), and access each pool's admin page.

### Accounts & access

- Log in with **email + password**; a public `@handle` is derived from the email
  (the email is never shown to other members).
- **Restrict sign-ups to one domain** with `ALLOWED_EMAIL_DOMAIN` (e.g. `example.com`);
  blank = any domain. Keep your deployment URL private among your group.
- **Password reset:** self-service at `/forgot` when SMTP is configured; otherwise
  an admin resets it from the pool admin page.
- **Who can create pools** is the `can_create_pools` site setting (`admin` by
  default; `anyone` lets any registered user create one).

### ⚠️ HTTPS is required in production

Session cookies use the `Secure` flag whenever `NODE_ENV` isn't `development`, so
**login silently fails over plain HTTP**. Terminate TLS at your host / reverse proxy
(automatic with HA ingress and most platforms). If you front it with nginx, forward
`Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` so the origin check passes.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string. |
| `NODE_ENV` | **yes (prod)** | `production` → `Secure` cookies + strict origin checks (needs HTTPS). |
| `ADMIN_USERNAME` | no | Email/handle auto-promoted to admin on register + boot. |
| `PORT` / `HOST` | no | Default `3000` / `0.0.0.0` (adapter-node). |
| `ALLOWED_EMAIL_DOMAIN` | no | Restrict sign-ups to one domain. Blank = any. |
| `PUBLIC_BASE_URL` | no | Public HTTPS base for email links (else derived from the request). |
| `SMTP_HOST` … `SMTP_FROM` | no | Email for verification + password reset. Blank = email off (use the admin reset instead). |
| `API_FOOTBALL_KEY` + `AUTO_SYNC_MINUTES` | no | Optional hands-off result import (api-sports.io). `0` minutes = manual entry only. |

> In production set these as real env vars on your host — don't ship a `.env`.

---

## Entering results & scoring

- **Manually:** open a pool's **admin page** and enter each finished match's score.
  Group matches score the 1/X/2 result; knockout rounds score who advanced. Saving
  re-scores all pools automatically.
- **Knockout teams:** knockout matches start as placeholders (teams unknown until
  the group stage finishes). Set a match's teams + score via the results API:

  ```sh
  POST /api/admin/results
  { "match_id": 208, "home_team_id": 2, "away_team_id": 5,
    "home_score": 1, "away_score": 0, "penalty_winner_id": null }
  ```
  `penalty_winner_id` is only for knockout draws decided on penalties.
- **Hands-off:** set `API_FOOTBALL_KEY` + `AUTO_SYNC_MINUTES` to import results
  automatically during the tournament.
- **Deadlines:** per-pool `deadline_group` / `deadline_knockout` (set on the pool
  admin page, in your local time) control when predictions lock; individual matches
  also lock at their real kickoff.

Scoring is fully configurable per pool in the admin (points per correct result, per
knockout round, champion bonus, 3rd place, and an optional bonus for a correct
derived group table).

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3470. |
| `npm run build` / `npm run start` | Production build / run the built server. |
| `npm run setup` | `migrate` + `seed` + `seed:matches` (full fresh-DB setup). |
| `npm run migrate` | Apply pending SQL migrations (`drizzle/migrations/*.sql`). |
| `npm run seed` | Seed the 48 teams / 12 groups (idempotent). |
| `npm run seed:matches` | Seed the 104 fixtures + kickoff schedule (idempotent; `-- --force` wipes and reseeds). |
| `npm test` | Unit tests (Vitest). |

### Integration tests

A separate suite runs real SQL against a **dedicated test database** (each test in a
rolled-back transaction):

```sh
TEST_DATABASE_URL="postgresql://..." \
  npx vitest run --config vitest.integration.config.ts
```

---

Teams and groups reflect the December 2025 draw; the group-stage kick-off schedule
is the official 2026 calendar. Both live in `src/lib/server/seed.ts` and
`src/lib/server/seed-matches.ts` if you need to adjust them.
