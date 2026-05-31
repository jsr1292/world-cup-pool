/**
 * Add-on bootstrap helper — applies two pieces of configuration to the database
 * on startup, using the app's existing `pg` dependency (no psql required):
 *
 *   1. site_settings.can_create_pools  ← CAN_CREATE_POOLS env  (admin | anyone)
 *   2. promote a named user to admin    ← ADMIN_USERNAME env    (optional)
 *
 * Both are idempotent and run on every boot. All input comes from environment
 * variables that run.sh derives from the Home Assistant add-on options; no
 * secrets are baked into the image. Errors here are non-fatal: we log a warning
 * and exit 0 so the app still starts (and surfaces its own DB errors if any).
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
	console.warn('[apply-config] DATABASE_URL not set — skipping.');
	process.exit(0);
}

const canCreate = (process.env.CAN_CREATE_POOLS || 'admin').trim();
const adminUser = (process.env.ADMIN_USERNAME || '').trim();

// Mirror the app's SSL logic (src/lib/server/db.ts): no SSL for local Postgres,
// relaxed verification for managed providers like Neon.
const ssl = url.includes('localhost') || url.includes('127.0.0.1')
	? false
	: { rejectUnauthorized: false };

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

try {
	// 1. can_create_pools (upsert) — only accept the two valid values.
	if (canCreate === 'admin' || canCreate === 'anyone') {
		await pool.query(
			`INSERT INTO site_settings (key, value) VALUES ('can_create_pools', $1)
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
			[canCreate]
		);
		console.log(`[apply-config] can_create_pools = ${canCreate}`);
	} else {
		console.warn(`[apply-config] Ignoring invalid can_create_pools='${canCreate}'.`);
	}

	// 2. Bootstrap admin (parameterized — no SQL injection from the option value).
	//    Matches by username (handle) OR email, since accounts log in by email
	//    and the username is an auto-derived handle.
	if (adminUser && adminUser !== 'null') {
		const res = await pool.query(
			'UPDATE users SET is_admin = true WHERE username = $1 OR lower(email) = lower($1)',
			[adminUser]
		);
		if (res.rowCount > 0) {
			console.log(`[apply-config] Promoted '${adminUser}' to admin.`);
		} else {
			console.warn(
				`[apply-config] admin_username '${adminUser}' not found. ` +
				'Register that account in the app first, then restart the add-on.'
			);
		}
	}
} catch (e) {
	// Most likely the schema isn't set up yet (run with run_setup=true once).
	console.warn(`[apply-config] Skipped (${e.message}). ` +
		'If this is a fresh database, enable "run_setup" once.');
} finally {
	await pool.end();
}

process.exit(0);
