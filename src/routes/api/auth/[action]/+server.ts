import { authenticateUser, createUser, createSession } from '$lib/server/queries.js';
import { json, redirect, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const action = url.pathname.split('/').pop(); // 'login', 'register', or 'logout'

  if (action === 'logout') {
    const token = cookies.get('session');
    if (token) {
      const { deleteSession } = await import('$lib/server/queries.js');
      deleteSession(token);
      cookies.delete('session', { path: '/' });
    }
    throw redirect(303, "/login");
  }

  const body = await request.json();

  if (action === 'register') {
    const { username, password, display_name } = body;
    if (!username || !password || !display_name) {
      return json({ error: 'All fields required' }, { status: 400 });
    }
    if (username.length < 3) return json({ error: 'Username must be 3+ chars' }, { status: 400 });
    if (password.length < 4) return json({ error: 'Password must be 4+ chars' }, { status: 400 });

    try {
      const result = createUser(username, password, display_name);
      const token = createSession(Number(result.lastInsertRowid));
      cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: false });
      return json({ ok: true });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint')) {
        return json({ error: 'Username already taken' }, { status: 409 });
      }
      return json({ error: 'Registration failed' }, { status: 500 });
    }
  }

  if (action === 'login') {
    const { username, password } = body;
    if (!username || !password) return json({ error: 'All fields required' }, { status: 400 });

    const user = authenticateUser(username, password);
    if (!user) return json({ error: 'Invalid credentials' }, { status: 401 });

    const token = createSession(user.id);
    cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: false });
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};
