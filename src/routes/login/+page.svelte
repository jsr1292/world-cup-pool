<script>
  let { data } = $props();
  let mode = $state('login');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let displayName = $state('');
  let error = $state('');
  let notice = $state('');
  let loading = $state(false);
  // After a failed login, offer a one-tap switch to register (carrying the email
  // over). We DON'T reveal whether the email exists — the hint shows on any
  // failed login, so it never leaks account existence.
  let showRegisterHint = $state(false);

  // Live confirm-password check (register only): true once the user has typed
  // something in the confirm box and it doesn't match the password.
  const passwordMismatch = $derived(
    mode === 'register' && passwordConfirm.length > 0 && passwordConfirm !== password
  );

  function switchMode(m) { mode = m; error = ''; notice = ''; showRegisterHint = false; }

  // Honor a ?redirect= target (e.g. from an invite link) — but only safe local
  // paths, never an absolute/protocol-relative URL (open-redirect guard).
  function postAuthTarget() {
    const r = new URLSearchParams(window.location.search).get('redirect');
    if (r && r.startsWith('/') && !r.startsWith('//')) return r;
    return '/';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    error = ''; notice = ''; showRegisterHint = false;
    loading = true;

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = mode === 'login'
      ? { email, password }
      : { email, password, password_confirm: passwordConfirm, display_name: displayName };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || 'Error';
        // Offer the register shortcut after a failed login (not on rate-limit).
        if (mode === 'login' && res.status !== 429 && email.trim()) showRegisterHint = true;
      } else if (data.verify) {
        // SMTP on: account created but must confirm via email before logging in.
        notice = data.mailFailed
          ? 'Cuenta creada, pero no se pudo enviar el correo de verificación. Pídele al administrador que lo revise.'
          : `Te hemos enviado un correo a ${email} para confirmar tu cuenta. Ábrelo para activar el acceso.`;
        mode = 'login';
      } else {
        window.location.href = postAuthTarget();
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
        onclick={() => switchMode('login')}
        style="flex: 1; padding: 10px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; border: none; background: {mode === 'login' ? 'rgba(201,168,76,0.1)' : 'transparent'}; color: {mode === 'login' ? 'var(--gold)' : 'var(--text-muted)'};"
      >Entrar</button>
      <button
        onclick={() => switchMode('register')}
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

      {#if mode === 'register'}
        <div>
          <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Confirmar contraseña</label>
          <input type="password" bind:value={passwordConfirm} placeholder="repite tu contraseña" required autocomplete="new-password" onpaste={(e) => e.preventDefault()}
            style={passwordMismatch ? 'border-color: var(--red);' : ''} aria-invalid={passwordMismatch} />
          {#if passwordMismatch}
            <p style="font-size: 9px; color: var(--red); margin-top: 5px;">Las contraseñas no coinciden</p>
          {/if}
        </div>
      {/if}

      {#if error}
        <p style="font-size: 10px; color: var(--red);">{error}</p>
      {/if}
      {#if showRegisterHint}
        <button type="button" onclick={() => switchMode('register')}
          style="background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 6px; padding: 9px 12px; font-size: 10px; color: var(--gold); cursor: pointer; text-align: center; line-height: 1.5;">
          ¿No tienes cuenta? <strong>Crear una con este correo →</strong>
        </button>
      {/if}
      {#if notice}
        <p style="font-size: 10px; color: var(--green); line-height: 1.5;">{notice}</p>
      {/if}

      <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading || passwordMismatch}>
        {loading ? '...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      </button>

      {#if mode === 'login'}
        <a href="/forgot" style="font-size: 10px; color: var(--text-muted); text-align: center; text-decoration: none; margin-top: 4px;">¿Olvidaste tu contraseña?</a>
      {/if}
    </form>
    </div>
  </div>
</div>
