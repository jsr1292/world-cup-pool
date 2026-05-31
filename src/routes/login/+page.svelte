<script>
  let { data } = $props();
  let mode = $state('login');
  let email = $state('');
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
      ? { email, password }
      : { email, password, display_name: displayName };

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

<div class="login-layout">
  <!-- Left panel: branding (desktop only) -->
  <div class="login-brand">
    <div>
      <div style="font-size: 56px; margin-bottom: 16px;">🏆</div>
      <h1 style="font-family: 'Libre Baskerville', serif; font-size: 36px; color: var(--gold); line-height: 1.2;">Mundial<br/>2026</h1>
      <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px; max-width: 280px; line-height: 1.6;">Predice los resultados del mundial con tus amigos. Crea o únete a una quiniela y compite por el primer puesto.</p>
      <div style="display: flex; gap: 20px; margin-top: 24px; font-size: 10px; color: var(--text-dim);">
        <div><span style="color: var(--gold); font-size: 18px; font-weight: 700; display: block;">48</span>Equipos</div>
        <div><span style="color: var(--gold); font-size: 18px; font-weight: 700; display: block;">104</span>Partidos</div>
        <div><span style="color: var(--gold); font-size: 18px; font-weight: 700; display: block;">12</span>Grupos</div>
      </div>
    </div>
  </div>

  <!-- Right panel: form -->
  <div class="login-form-area">
    <div style="width: 100%; max-width: 360px;">
      <!-- Mobile header (hidden on desktop) -->
      <div class="login-mobile-header" style="text-align: center; margin-bottom: 32px;">
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
        <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Correo</label>
        <input type="email" bind:value={email} placeholder="tu@correo.com" required autocomplete="email" />
      </div>

      {#if mode === 'register'}
        <div>
          <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Nombre</label>
          <input bind:value={displayName} placeholder="Tu nombre" required autocomplete="name" />
        </div>
      {/if}

      <div>
        <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Contraseña</label>
        <input type="password" bind:value={password} placeholder="••••••••" required autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </div>

      {#if error}
        <p style="font-size: 10px; color: var(--red);">{error}</p>
      {/if}

      <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>
        {loading ? '...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      </button>

      {#if mode === 'login'}
        <a href="/forgot" style="font-size: 10px; color: var(--text-muted); text-align: center; text-decoration: none; margin-top: 4px;">¿Olvidaste tu contraseña?</a>
      {/if}
    </form>
    </div>
  </div>
</div>

<style>
  .login-layout {
    min-height: 100dvh;
    display: flex;
    align-items: stretch;
  }
  .login-brand {
    display: none;
  }
  .login-form-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  @media (min-width: 768px) {
    .login-layout {
      flex-direction: row;
    }
    .login-brand {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 45%;
      background: linear-gradient(135deg, rgba(201,168,76,0.1) 0%, rgba(7,9,15,0.5) 100%);
      border-right: 1px solid var(--border);
      padding: 60px;
    }
    .login-form-area {
      width: 55%;
    }
    .login-mobile-header {
      display: none !important;
    }
  }
</style>
