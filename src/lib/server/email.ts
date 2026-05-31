/**
 * Outbound email via SMTP (nodemailer). Configured entirely from env vars so
 * the repo ships with no provider baked in:
 *
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  — connection + auth
 *   SMTP_FROM                                   — From: header (e.g. "Pool <no-reply@x>")
 *   SMTP_SECURE                                 — "true" to force TLS-on-connect
 *
 * If SMTP_HOST is not set, email is considered disabled and send attempts throw
 * a clearly-typed error (callers decide how to surface that).
 */
import nodemailer, { type Transporter } from 'nodemailer';

let _transport: Transporter | null = null;

export function isEmailConfigured(): boolean {
	return !!process.env.SMTP_HOST;
}

function getTransport(): Transporter {
	if (!isEmailConfigured()) {
		const err = new Error('SMTP is not configured (SMTP_HOST unset)');
		(err as any).code = 'EMAIL_DISABLED';
		throw err;
	}
	if (!_transport) {
		const port = Number(process.env.SMTP_PORT) || 587;
		const secure = process.env.SMTP_SECURE
			? process.env.SMTP_SECURE === 'true'
			: port === 465; // 465 = implicit TLS; 587 = STARTTLS
		const user = process.env.SMTP_USER;
		const pass = process.env.SMTP_PASS;
		_transport = nodemailer.createTransport({
			host: process.env.SMTP_HOST,
			port,
			secure,
			auth: user ? { user, pass } : undefined,
		});
	}
	return _transport;
}

function fromAddress(): string {
	return process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost';
}

/** Send the password-reset email. Throws EMAIL_DISABLED if SMTP isn't set up. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
	const transport = getTransport();
	const text =
		`Has solicitado restablecer tu contraseña.\n\n` +
		`Abre este enlace para elegir una nueva contraseña (válido 1 hora):\n${resetUrl}\n\n` +
		`Si no fuiste tú, ignora este correo — tu contraseña no cambiará.`;
	const html =
		`<p>Has solicitado restablecer tu contraseña.</p>` +
		`<p><a href="${resetUrl}">Elegir una nueva contraseña</a> (válido 1 hora).</p>` +
		`<p>Si no fuiste tú, ignora este correo — tu contraseña no cambiará.</p>`;
	await transport.sendMail({
		from: fromAddress(),
		to,
		subject: 'Restablecer contraseña — Mundial 2026',
		text,
		html,
	});
}
