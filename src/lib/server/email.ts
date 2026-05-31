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
import type { PredictionSummary } from './prediction-summary.js';

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

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Send a confirmation of the user's predictions ("here's what you bet"). Throws
 * EMAIL_DISABLED if SMTP isn't set up.
 */
export async function sendPredictionSummaryEmail(
	to: string,
	summary: PredictionSummary,
	opts: { locked?: boolean } = {}
): Promise<void> {
	const transport = getTransport();
	const lead = opts.locked
		? `Las predicciones de "${summary.poolName}" se han cerrado. Esto es lo que has pronosticado:`
		: `Esto es lo que has pronosticado en "${summary.poolName}":`;

	// ── Plain text ──
	const tLines: string[] = [lead, ''];
	if (summary.groups.length) {
		tLines.push('FASE DE GRUPOS');
		for (const g of summary.groups) {
			tLines.push(`  Grupo ${g.group}: ` + g.teams.map(t => `${t.pos}. ${t.name}`).join('  '));
		}
		tLines.push('');
	}
	if (summary.bracket.length) {
		tLines.push('ELIMINATORIAS');
		for (const ph of summary.bracket) {
			tLines.push(`  ${ph.phaseLabel}: ` + ph.teams.map(t => t.name).join(', '));
		}
		tLines.push('');
	}
	if (!summary.groups.length && !summary.bracket.length) {
		tLines.push('(Aún no has registrado predicciones.)');
	}
	tLines.push('¡Suerte! — Mundial 2026 · Quiniela');

	// ── HTML ──
	const groupHtml = summary.groups.map(g =>
		`<div style="margin:6px 0;"><strong>Grupo ${esc(g.group)}</strong>: ` +
		g.teams.map(t => `${t.flag} ${t.pos}. ${esc(t.name)}`).join(' &nbsp; ') + `</div>`
	).join('');
	const bracketHtml = summary.bracket.map(ph =>
		`<div style="margin:6px 0;"><strong>${esc(ph.phaseLabel)}</strong>: ` +
		ph.teams.map(t => `${t.flag} ${esc(t.name)}`).join(', ') + `</div>`
	).join('');
	const html =
		`<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;">` +
		`<h2 style="color:#c9a84c;margin-bottom:4px;">📋 Tus predicciones</h2>` +
		`<p style="color:#555;font-size:14px;">${esc(lead)} <em>(${esc(summary.label)})</em></p>` +
		(summary.groups.length ? `<h3 style="margin:14px 0 4px;">🏆 Fase de Grupos</h3>${groupHtml}` : '') +
		(summary.bracket.length ? `<h3 style="margin:14px 0 4px;">⚔️ Eliminatorias</h3>${bracketHtml}` : '') +
		(!summary.groups.length && !summary.bracket.length ? `<p>(Aún no has registrado predicciones.)</p>` : '') +
		`<p style="color:#888;font-size:12px;margin-top:16px;">¡Suerte! — Mundial 2026 · Quiniela</p>` +
		`</div>`;

	await transport.sendMail({
		from: fromAddress(),
		to,
		subject: `Tus predicciones — ${summary.poolName}`,
		text: tLines.join('\n'),
		html,
	});
}
