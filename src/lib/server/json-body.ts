import { json } from '@sveltejs/kit';

// §3.1 — One reusable JSON body parser. Returns either { ok: true, body } or
// a ready-to-return 400 Response with the standard Spanish error message.
export async function parseJsonBody(request: Request):
	Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
	try {
		const body = await request.json();
		return { ok: true, body };
	} catch {
		return {
			ok: false,
			response: json({ error: 'Cuerpo JSON inválido' }, { status: 400 }),
		};
	}
}

// §3.2 — Coerce a client-supplied id (route/query param or body field) to a
// positive 32-bit integer, or null. `Number(x)` alone lets 1.5, "abc"→NaN,
// Infinity, 1e20 and hex strings through to a Postgres int cast, which throws
// and surfaces as a 500. Callers treat null as "missing/invalid" (400/404).
export function asId(v: unknown): number | null {
	const n =
		typeof v === 'number' ? v :
		typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}
