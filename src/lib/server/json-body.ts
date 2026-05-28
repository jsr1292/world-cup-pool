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
