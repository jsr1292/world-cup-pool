import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/queries.js', () => ({
	getUserIdByEmail: vi.fn(),
	createPasswordResetToken: vi.fn(),
	consumePasswordResetToken: vi.fn(),
	setUserPassword: vi.fn(),
}));
vi.mock('$lib/server/email.js', () => ({
	isEmailConfigured: vi.fn(() => true),
	sendPasswordResetEmail: vi.fn(),
}));

import { POST as forgotPOST } from '../../routes/api/auth/forgot/+server.ts';
import { POST as resetPOST } from '../../routes/api/auth/reset/+server.ts';
import {
	getUserIdByEmail,
	createPasswordResetToken,
	consumePasswordResetToken,
	setUserPassword,
} from '$lib/server/queries.js';
import { isEmailConfigured, sendPasswordResetEmail } from '$lib/server/email.js';

const req = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
let ipCounter = 0;
const forgotEvent = (body: any) => ({
	request: req(body),
	// Unique IP per call so the per-IP rate limiter doesn't bleed across tests.
	getClientAddress: () => `203.0.113.${ipCounter++ % 250}`,
	url: new URL('http://localhost:3000/api/auth/forgot'),
});

beforeEach(() => {
	vi.clearAllMocks();
	(isEmailConfigured as any).mockReturnValue(true);
});

describe('POST /api/auth/forgot', () => {
	it('sends a reset email when the user exists (generic 200)', async () => {
		(getUserIdByEmail as any).mockResolvedValue(55);
		(createPasswordResetToken as any).mockResolvedValue('RAWTOKEN');

		const res = await forgotPOST(forgotEvent({ email: 'alice@typsa.es' }) as any);
		expect(res.status).toBe(200);
		expect(createPasswordResetToken).toHaveBeenCalledWith(55);
		// link points at PUBLIC_BASE_URL or request origin + /reset?token=
		const [, link] = (sendPasswordResetEmail as any).mock.calls[0];
		expect(link).toContain('/reset?token=RAWTOKEN');
	});

	it('does NOT reveal that an email is unknown (anti-enumeration)', async () => {
		(getUserIdByEmail as any).mockResolvedValue(null);

		const res = await forgotPOST(forgotEvent({ email: 'ghost@typsa.es' }) as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(sendPasswordResetEmail).not.toHaveBeenCalled(); // no email, but same response
	});

	it('returns generic success (no send) for an invalid email', async () => {
		const res = await forgotPOST(forgotEvent({ email: 'nope' }) as any);
		expect(res.status).toBe(200);
		expect(getUserIdByEmail).not.toHaveBeenCalled();
		expect(sendPasswordResetEmail).not.toHaveBeenCalled();
	});

	it('returns generic success (no send) when SMTP is not configured', async () => {
		(isEmailConfigured as any).mockReturnValue(false);
		const res = await forgotPOST(forgotEvent({ email: 'alice@typsa.es' }) as any);
		expect(res.status).toBe(200);
		expect(sendPasswordResetEmail).not.toHaveBeenCalled();
	});
});

describe('POST /api/auth/reset', () => {
	it('sets the new password for a valid token', async () => {
		(consumePasswordResetToken as any).mockResolvedValue(77);
		const res = await resetPOST({ request: req({ token: 'GOOD', new_password: 'newpass1' }) } as any);
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);
		expect(consumePasswordResetToken).toHaveBeenCalledWith('GOOD');
		expect(setUserPassword).toHaveBeenCalledWith(77, 'newpass1');
	});

	it('rejects an invalid/expired token (400) and never sets a password', async () => {
		(consumePasswordResetToken as any).mockResolvedValue(null);
		const res = await resetPOST({ request: req({ token: 'BAD', new_password: 'newpass1' }) } as any);
		expect(res.status).toBe(400);
		expect(setUserPassword).not.toHaveBeenCalled();
	});

	it('rejects a too-short password (400)', async () => {
		const res = await resetPOST({ request: req({ token: 'GOOD', new_password: '123' }) } as any);
		expect(res.status).toBe(400);
		expect(consumePasswordResetToken).not.toHaveBeenCalled();
	});

	it('rejects a missing token (400)', async () => {
		const res = await resetPOST({ request: req({ new_password: 'newpass1' }) } as any);
		expect(res.status).toBe(400);
	});
});
