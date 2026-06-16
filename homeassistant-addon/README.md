# World Cup Pool — Home Assistant Add-on

Run the World Cup Pool app as a Home Assistant add-on on a Raspberry Pi 5
(HA OS, aarch64), using an external **Neon** PostgreSQL database. All settings —
database URL, admin bootstrap, pool-creation policy — are entered in the add-on's
**Configuration** form; nothing is hardcoded.

---

## How it works

The add-on image (built on `node:22-alpine`) clones this repository, runs
`npm run build`, and starts the production server (`node build/index.js`). On
each start, `run.sh`:

1. Reads the options you set in the HA form (via `bashio`).
2. Exports them as the env vars the app expects (`DATABASE_URL`, `NODE_ENV`, …).
3. Optionally runs `npm run setup` (migrations + 48 teams + 104 fixtures) if
   `run_setup` is on — **idempotent**, safe to re-run.
4. Applies `can_create_pools` and (optionally) promotes `admin_username` to admin,
   using the app's `pg` driver (no `psql` needed).
5. Starts the app on `0.0.0.0:3000`, served via **ingress** (HTTPS in the HA
   sidebar) and the mapped host port `3000` (LAN / DuckDNS).

> ⚠️ **Prerequisite — push the code first.** The image is built by cloning the
> GitHub repo (`build.yaml` → `REPO_URL`/`REPO_REF`, default branch `master`).
> Commit and push the app **and** this `homeassistant-addon/` folder to GitHub
> before installing, so the Pi builds the current code (including the fixtures
> seeder). To build a different branch/tag, edit `REPO_REF` in `build.yaml`.

---

## Configuration form

| Option | Type | Default | Effect |
|---|---|---|---|
| `database_url` | string (**required**) | — | Neon/Postgres connection string, e.g. `postgresql://user:pass@host/db?sslmode=require`. Exported as `DATABASE_URL`. |
| `node_env` | `production` \| `development` | `production` | `production` → `Secure` session cookies + strict cross-origin checks. **Requires HTTPS** (ingress and your reverse proxy both provide it). |
| `can_create_pools` | `admin` \| `anyone` | `admin` | Writes `site_settings.can_create_pools`. `admin` = only admins create pools (recommended for a private group). |
| `admin_username` | string (optional) | — | If set, the **existing** user with this username is promoted to admin on startup (idempotent). Leave blank if you promote manually. |
| `run_setup` | bool | `false` | If on, runs migrations + seeds teams + seeds the 104 match fixtures on startup. Turn on for the **first** boot against a fresh database; safe to leave on (idempotent) or switch off afterward. |
| `xff_depth` | int | `1` | Trusted-proxy count for reading the client IP (rate-limiting). See the comment in the config form. |
| `allowed_email_domain` | string (optional) | — | Restrict sign-ups to this email domain (e.g. `example.com`). Blank = any domain. |
| `public_base_url` | string (optional) | — | Public HTTPS base URL for password-reset links, e.g. `https://you.duckdns.org`. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_pass` / `smtp_from` | string / int / masked | — / `587` / — | SMTP settings for password-reset emails. Leave `smtp_host` blank to disable self-service reset (use admin reset instead). |
| `api_football_key` | masked (optional) | — | API-Football (api-sports.io) key. With this set, the app can import results automatically. |
| `auto_sync_minutes` | int | `0` | Idle gap between result imports, in minutes. `0` = off. Floored to 5 min. Suggested `15`–`30`. On the free FIFA source the schedule is **adaptive**: it polls every ~90s while a match is in play (so finals post within ~a minute) and only falls back to this gap between matches. |

### Hands-off results (automatic scoring)

By default you enter results yourself on a pool's **admin → Resultados** page
(group scores; for knockouts you also pick the two teams and, on a draw, the
penalty winner). To run **fully hands-off**:

1. Create a free **API-Football** account at api-sports.io and copy your key.
2. Put it in `api_football_key` and set `auto_sync_minutes` (e.g. `20`).

The app then polls for finished matches and writes them in automatically —
group scores (keeping your home/away orientation), knockout matchups (assigning
the two teams to the right round), and penalty-shootout winners — then rescopes
every pool. The free tier (100 req/day) is ample at a 15–30 min interval. You can
also press **🔄 Sincronizar ahora** on the admin page to pull immediately. Team
names that don't resolve are listed so you can add an alias; most are covered
out of the box (USA, Czechia, Korea Republic, Côte d'Ivoire, Türkiye, …).

### Login & password reset

Accounts log in with **email + password**. To restrict who can register, set
`allowed_email_domain` (e.g. `example.com`). For self-service "forgot password",
fill the `smtp_*` fields and `public_base_url` (the reset link must use your
public DuckDNS HTTPS URL). If SMTP is left blank, you reset passwords as admin.

**Email verification** adapts to your setup: registration always has a
"confirm email" field (typo guard). When SMTP **is** configured, new sign-ups
must also click an emailed link before they can log in (a blocked login
auto-resends a fresh link); when SMTP is **not** configured, accounts activate
immediately. Existing accounts are grandfathered as verified, so enabling SMTP
never locks anyone out.

### Admin bootstrap — how it works

There is no in-app "make me admin" button. Two ways to get your first admin:

1. **Via the form (recommended):** register your account in the app first, then
   put your **email** (or your derived handle) in `admin_username` and restart the
   add-on. You'll see `Promoted '<name>' to admin` in the add-on log. If the user
   doesn't exist yet, the log warns and nothing changes — register, then restart.
2. **Manually:** `UPDATE users SET is_admin = true WHERE email = '…';`

Registration is open to anyone whose email matches `allowed_email_domain` (or
anyone, if it's blank) — keep your URL private, and leave `can_create_pools`
on `admin`.

---

## Install (local add-on)

You don't need to publish an add-on repository. Use the **local add-on** method:

1. On the Pi, open the **Samba** or **SSH/Terminal** add-on so you can reach the
   `/addons` share (a.k.a. `/root/addons` via the SSH add-on; `addon_configs` is
   different — use the **`addons`** folder).
2. Copy this `homeassistant-addon/` folder into `/addons/` and rename it, e.g.
   `/addons/world-cup-pool/` (it must contain `config.yaml`, `Dockerfile`,
   `build.yaml`, `run.sh`, `apply-config.mjs`).
   - Easiest: `git clone https://github.com/jsr1292/world-cup-pool` somewhere on
     the Pi and copy its `homeassistant-addon` folder to `/addons/world-cup-pool`.
3. In HA: **Settings → Add-ons → Add-on Store → ⋮ (top right) → Check for
   updates**. A **Local add-ons** section appears with **World Cup Pool**.
4. Open it → **Install** (the Pi builds the image; first build takes a few
   minutes as it clones + `npm ci` + builds).
5. Go to the **Configuration** tab, fill in `database_url`, set `run_setup: true`
   for the first start, optionally set `admin_username`, **Save**.
6. **Start** the add-on. Watch the **Log** tab: you should see setup output (if
   enabled), `Promoted '…' to admin` (if set), then
   `Starting World Cup Pool on 0.0.0.0:3000`.
7. After a healthy first boot you can set `run_setup: false` and, if you like,
   flip **Start on boot** + **Watchdog** on, and set `boot: auto`.

> Alternative install: add this repo as a custom add-on repository
> (**Add-on Store → ⋮ → Repositories →** `https://github.com/jsr1292/world-cup-pool`).
> That works if a `repository.yaml` is present at the repo root; the local-folder
> method above needs no extra files.

---

## Accessing the app

### Via ingress (easiest, HTTPS automatic)
Click **Open Web UI** on the add-on page, or use the **World Cup Pool** item in
the HA sidebar. Ingress proxies to the app over the internal Docker network and
serves it under your HA URL with HA's TLS — `node_env: production` is satisfied.

### Via LAN / DuckDNS reverse proxy (direct port)
The add-on also listens on host port **3000** (`ports: 3000/tcp`). To expose it
publicly through your existing **DuckDNS + reverse proxy** (e.g. the NGINX Home
Assistant add-on or Caddy):

- Proxy your chosen hostname to **`http://<pi-lan-ip>:3000`**.
- **Terminate TLS at the reverse proxy** (DuckDNS + Let's Encrypt). Browsers only
  store the app's `Secure` session cookie over HTTPS, so the public URL must be
  `https://…`. The proxy terminating TLS satisfies this — the app itself can
  receive plain HTTP from the proxy on port 3000.
- **Forward these headers** so the app computes the right origin (its CSRF check
  compares the browser `Origin` to the derived request origin):

  ```nginx
  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-Host  $host;
  proxy_set_header X-Forwarded-Proto $scheme;   # must be https at the edge
  proxy_set_header X-Forwarded-For   $remote_addr;
  ```

  `run.sh` sets `HOST_HEADER=x-forwarded-host` and `PROTOCOL_HEADER=x-forwarded-proto`
  so adapter-node honours them. If your proxy doesn't send these, the app falls
  back to the `Host` header — keep `proxy_set_header Host $host;` at minimum.

---

## Resource use on the Pi 5

- The Node server is light (typically ~80–150 MB RSS). `run.sh` sets
  `NODE_OPTIONS=--max-old-space-size=256` so the heap can't balloon and starve
  Home Assistant.
- The DB connection pool is capped at `max: 10` per the app config; with one
  add-on instance that's the ceiling. Neon's pooler endpoint handles the rest.
- The build step (clone + `npm ci` + `npm run build`) runs once at install/update
  time and is the heaviest moment; steady-state runtime is modest.
- HA add-ons don't expose a hard memory limit in `config.yaml`; the heap cap
  above is the practical guard. If you want a container memory limit, set it via
  the Supervisor (advanced) — not required for normal use.

---

## Updating

Push new code to GitHub, then in the add-on: **⋮ → Rebuild** (it re-clones
`REPO_REF` and rebuilds). Your configuration and the external Neon data persist
(nothing is stored in the container).

---

## Files

| File | Purpose |
|---|---|
| `config.yaml` | Add-on manifest: metadata, arch, ingress + port, options/schema (the form). |
| `build.yaml` | Per-arch base image (`node:22-alpine`) and build args (`REPO_URL`/`REPO_REF`). |
| `Dockerfile` | Installs bashio, clones + builds the app, sets the entrypoint. |
| `run.sh` | bashio entrypoint: options → env, optional setup, admin/site-settings, start. |
| `apply-config.mjs` | Idempotent DB helper (admin promote + `can_create_pools`) via `pg`. |
