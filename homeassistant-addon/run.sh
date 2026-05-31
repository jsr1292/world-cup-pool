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
# derives the real request origin. This is what makes the app's CSRF origin
# check pass on BOTH the ingress path and the DuckDNS reverse-proxy path.
export PROTOCOL_HEADER="x-forwarded-proto"
export HOST_HEADER="x-forwarded-host"
export ADDRESS_HEADER="x-forwarded-for"
# #11 — trust exactly `xff_depth` proxies when reading the client IP from
# X-Forwarded-For, so login rate-limiting keys on the real client. Default 1.
export XFF_DEPTH="${XFF_DEPTH:-1}"

# Gentle heap cap — this add-on shares the Raspberry Pi with Home Assistant.
export NODE_OPTIONS="--max-old-space-size=256"

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
