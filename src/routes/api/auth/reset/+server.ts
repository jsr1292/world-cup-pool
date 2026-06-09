import { json, type RequestHandler } from '@sveltejs/kit';
import { consumePasswordResetToken, setUserPassword } from '$lib/server/queries.js';

// POST /api/auth/reset  Body: { token, new_password }
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const { token, new_password } = (body ?? {}) as Record<string, any>;

	if (!token || typeof token !== 'string') {
		return json({ error: 'Enlace inválido' }, { status: 400 });
	}
	if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
		return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
	}
	// bcrypt only uses the first 72 bytes; cap to avoid pointless hashing work.
	if (new_password.length > 256) {
		return json({ error: 'La contraseña es demasiado larga (máximo 256)' }, { status: 400 });
	}

	// Atomically consume the token (valid, unused, unexpired) → user id.
	const userId = await consumePasswordResetToken(token);
	if (!userId) {
		return json({ error: 'El enlace no es válido o ha caducado' }, { status: 400 });
	}

	// Set the new password and invalidate all existing sessions for that user.
	await setUserPassword(userId, new_password);
	return json({ ok: true });
};
