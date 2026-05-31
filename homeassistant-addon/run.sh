#!/usr/bin/env bashio
# shellcheck shell=bash
# Entrypoint for the World Cup Pool add-on.
# Reads the HA options, maps them to the env vars the app expects, optionally
# bootstraps the database, then starts the production server.
set -e

# ── Read options from the HA configuration form ─────────────────────────────
DATABASE_URL="$(bashio::config 'database_url')"
NODE_ENV="$(bashio::config 'node_env')"
CAN_CREATE_POOLS="$(bashio::config 'can_create_pools')"
ADMIN_USERNAME="$(bashio::config 'admin_username')"
XFF_DEPTH="$(bashio::config 'xff_depth')"
ALLOWED_EMAIL_DOMAIN="$(bashio::config 'allowed_email_domain')"
PUBLIC_BASE_URL="$(bashio::config 'public_base_url')"
SMTP_HOST="$(bashio::config 'smtp_host')"
SMTP_PORT="$(bashio::config 'smtp_port')"
SMTP_USER="$(bashio::config 'smtp_user')"
SMTP_PASS="$(bashio::config 'smtp_pass')"
SMTP_FROM="$(bashio::config 'smtp_from')"
API_FOOTBALL_KEY="$(bashio::config 'api_football_key')"
AUTO_SYNC_MINUTES="$(bashio::config 'auto_sync_minutes')"

# database_url is required.
if bashio::var.is_empty "${DATABASE_URL}" || [ "${DATABASE_URL}" = "null" ]; then
	bashio::log.fatal "database_url is empty — set it in the add-on Configuration tab."
	bashio::exit.nok
fi

# ── Export the env the app + helpers read ───────────────────────────────────
export DATABASE_URL
export NODE_ENV
export HOST="0.0.0.0"
export PORT="3000"

# Trust HA ingress / reverse-proxy forwarded headers so SvelteKit (adapter-node)
# derives the real request origin. These fall back to the Host header when the
# forwarded header is absent, so they're safe on direct access too.
export PROTOCOL_HEADER="x-forwarded-proto"
export HOST_HEADER="x-forwarded-host"
# IMPORTANT: do NOT set ADDRESS_HEADER. adapter-node's getClientAddress()
# THROWS (HTTP 500) when ADDRESS_HEADER is set but the header is absent — which
# happens on direct LAN/IP access (no proxy adds x-forwarded-for), breaking
# login/registration. Leaving it unset makes rate-limiting key on the socket
# address, which works on every access path. (xff_depth is consequently unused.)

# Gentle heap cap — this add-on shares the Raspberry Pi with Home Assistant.
export NODE_OPTIONS="--max-old-space-size=256"

# Email-auth: signup-domain restriction (blank = any) and password-reset email.
# bashio returns 'null' for unset optional values — normalize those to empty.
[ "${ALLOWED_EMAIL_DOMAIN}" = "null" ] && ALLOWED_EMAIL_DOMAIN=""
[ "${PUBLIC_BASE_URL}" = "null" ] && PUBLIC_BASE_URL=""
[ "${SMTP_HOST}" = "null" ] && SMTP_HOST=""
[ "${SMTP_USER}" = "null" ] && SMTP_USER=""
[ "${SMTP_PASS}" = "null" ] && SMTP_PASS=""
[ "${SMTP_FROM}" = "null" ] && SMTP_FROM=""
export ALLOWED_EMAIL_DOMAIN PUBLIC_BASE_URL
export SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM

# Hands-off live results: API-Football key + auto-sync interval (0 = off).
[ "${API_FOOTBALL_KEY}" = "null" ] && API_FOOTBALL_KEY=""
[ "${AUTO_SYNC_MINUTES}" = "null" ] && AUTO_SYNC_MINUTES="0"
export API_FOOTBALL_KEY AUTO_SYNC_MINUTES

cd /app

# ── Optional one-shot DB bootstrap (idempotent) ─────────────────────────────
if bashio::config.true 'run_setup'; then
	bashio::log.info "run_setup=true: applying migrations + 48 teams + 104 fixtures (idempotent)…"
	if npm run setup; then
		bashio::log.info "Setup OK. It's idempotent, so leaving run_setup on is safe; you may switch it off."
	else
		bashio::log.fatal "Setup failed — check the database_url and that the DB is reachable."
		bashio::exit.nok
	fi
fi

# ── Apply admin bootstrap + can_create_pools (idempotent, every boot) ───────
export ADMIN_USERNAME
export CAN_CREATE_POOLS
bashio::log.info "Applying site settings (can_create_pools=${CAN_CREATE_POOLS}; admin_username='${ADMIN_USERNAME}')…"
node /app/apply-config.mjs || bashio::log.warning "apply-config reported an issue (continuing)."

# ── Start the app ───────────────────────────────────────────────────────────
bashio::log.info "Starting World Cup Pool on ${HOST}:${PORT} (ingress + host port ${PORT}, NODE_ENV=${NODE_ENV})…"
exec node build/index.js
