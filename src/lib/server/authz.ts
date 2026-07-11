// Shared authorization predicates.

/**
 * Whether `user` may manage a pool's admin settings (scoring rules, deadlines,
 * payments, membership, recalculation). Allowed for the pool creator OR any
 * site admin.
 *
 * `is_admin` may arrive as a Postgres boolean or, per app.d.ts, a number — so
 * it is checked truthily rather than with a strict `=== true`.
 */
export function canManagePool(
	pool: { created_by: number } | null | undefined,
	user: { id: number; is_admin?: boolean | number | null }
): boolean {
	if (!pool) return false;
	return pool.created_by === user.id || !!user.is_admin;
}
