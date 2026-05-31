import { json, type RequestHandler } from '@sveltejs/kit';
import { getUserIdByEmail, createPasswordResetToken } from '$lib/server/queries.js';
import { isValidEmail } from '$lib/server/email-policy.js';
import { sendPasswordResetEmail, isEmailConfigured } from '$lib/server/email.js';

// In-process rate limit per IP (5 / 15 min). Process-local, like the other
// limiters — fine for a single instance; see rate-limit.ts for the caveat.
const _attempts = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 5;
const WINDOW = 15 * 60 * 1000;
function rateOk(ip: string): boolean {
	const now = Date.now();
	if (_attempts.size > 10_000) for (const [k, v] of _attempts) if (now > v.resetAt) _attempts.delete(k);
	const e = _attempts.get(ip);
	if (!e || now > e.resetAt) { _attempts.set(ip, { count: 1, resetAt: now + WINDOW }); return true; }
	if (e.count >= LIMIT) return false;
	e.count++;
	return true;
}

// POST /api/auth/forgot  Body: { email }
// Always returns a generic success (no account enumeration).
export const POST: RequestHandler = async ({ request, getClientAddress, url }) => {
	// Generic response used for every outcome.
	const generic = json({ ok: true, message: 'Si el correo está registrado, te enviamos un enlace.' });

	if (!rateOk(getClientAddress())) return generic;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const { email } = (body ?? {}) as Record<string, any>;
	if (!isValidEmail(email)) return generic;

	if (!isEmailConfigured()) {
		console.warn('[auth/forgot] SMTP not configured — cannot send reset email.');
		return generic;
	}

	try {
		const userId = await getUserIdByEmail(email);
		if (userId) {
			const raw = await createPasswordResetToken(userId);
			const base = (process.env.PUBLIC_BASE_URL || url.origin).replace(/\/+$/, '');
			const link = `${base}/reset?token=${encodeURIComponent(raw)}`;
			await sendPasswordResetEmail(email.trim(), link);
		}
	} catch (e) {
		// Don't leak failures to the caller; just log.
		console.error('[auth/forgot] error:', e);
	}
	return generic;
};
