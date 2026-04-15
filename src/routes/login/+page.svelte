<script>
  let { data } = $props();
  let mode = $state('login');
  let username = $state('');
  let password = $state('');
  let displayName = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';
    loading = true;

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = mode === 'login'
      ? { username, password }
      : { username, password, display_name: displayName };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || 'Error';
      } else {
        window.location.href = '/';
      }
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
    }
  }
</script>

<div style="min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px;">
  <div style="width: 100%; max-width: 360px;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="font-size: 40px; margin-bottom: 8px;">⚽</div>
      <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">Mundial 2026</h1>
      <p style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 4px;">Quiniela</p>
    </div>

    <div style="display: flex; gap: 0; margin-bottom: 24px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
      <button
        onclick={() => { mode = 'login'; error = ''; }}
        style="flex: 1; padding: 10px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; border: none; background: {mode === 'login' ? 'rgba(201,168,76,0.1)' : 'transparent'}; color: {mode === 'login' ? 'var(--gold)' : 'var(--text-muted)'};"
      >Entrar</button>
      <button
        onclick={() => { mode = 'register'; error = ''; }}
        style="flex: 1; padding: 10px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; border: none; border-left: 1px solid var(--border); background: {mode === 'register' ? 'rgba(201,168,76,0.1)' : 'transparent'}; color: {mode === 'register' ? 'var(--gold)' : 'var(--text-muted)'};"
      >Registro</button>
    </div>

    <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: 14px;">
      <div>
        <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5; letter-spacing: 0.12em; text-transform: uppercase;">Usuario</label>
        <input bind:value={username} placeholder="usuario" required autocomplete="username" />
      </div>

      {#if mode === 'register'}
        <div>
          <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5; letter-spacing: 0.12em; text-transform: uppercase;">Nombre</label>
          <input bind:value={displayName} placeholder="Tu nombre" required />
        </div>
      {/if}

      <div>
        <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5; letter-spacing: 0.12em; text-transform: uppercase;">Contraseña</label>
        <input type="password" bind:value={password} placeholder="••••••••" required autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </div>

      {#if error}
        <p style="font-size: 10px; color: var(--red);">{error}</p>
      {/if}

      <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>
        {loading ? '...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      </button>
    </form>
  </div>
</div>
