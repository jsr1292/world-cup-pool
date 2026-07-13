import type { Pool } from './types.js';

/**
 * Allowlist of pool columns that are safe to serialize to the client.
 *
 * Excludes the durable secrets `invite_code` and `share_token`: a single leak
 * of either grants permanent access (they never expire) — `invite_code` to
 * join the pool via /join/[code], `share_token` to the public scoreboard at
 * /s/[code]. Any `load` function that returns a pool to the browser should
 * return `toSafePool(pool)`, never the raw `SELECT * FROM pools` row.
 *
 * This is an allowlist, not a denylist, so a future pools column never leaks
 * by default — you must add it here explicitly.
 *
 * Deliberate exception: the main pool page (`pool/[id]/+page.server.ts`) needs
 * both tokens for the member-facing invite / share-scoreboard buttons.
 */
export function toSafePool(pool: Pool) {
  return {
    id: pool.id,
    name: pool.name,
    buy_in: pool.buy_in,
    currency: pool.currency,
    is_active: pool.is_active,
    created_by: pool.created_by,
    allow_multiple_predictions: pool.allow_multiple_predictions,
    deadline_group: pool.deadline_group,
    deadline_knockout: pool.deadline_knockout,
  };
}
