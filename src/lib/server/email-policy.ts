/**
 * Email format + signup-domain policy. The allowed signup domain is configured
 * via ALLOWED_EMAIL_DOMAIN (e.g. "example.com"). If it's unset/blank, ANY domain
 * is allowed — so the repo ships with no built-in restriction.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
	return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

/** The configured signup domain, lowercased, with a leading '@' stripped. '' = no restriction. */
export function allowedEmailDomain(): string {
	return (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
}

export function isEmailDomainAllowed(email: string): boolean {
	const domain = allowedEmailDomain();
	if (!domain) return true; // no restriction configured
	return email.trim().toLowerCase().endsWith('@' + domain);
}
