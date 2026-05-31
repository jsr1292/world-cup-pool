<script>
  let email = $state('');
  let sent = $state(false);
  let error = $state('');
  let loading = $state(false);

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        sent = true;
      } else {
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Error';
      }
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-layout">
  <div class="login-form-area" style="grid-column: 1 / -1;">
    <div style="width: 100%; max-width: 360px;">
      <div style="text-align: center; margin-bottom: 28px;">
        <div style="font-size: 40px; margin-bottom: 8px;">🔑</div>
        <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">Restablecer contraseña</h1>
      </div>

      {#if sent}
        <p style="font-size: 12px; color: var(--text-muted); line-height: 1.6; text-align: center;">
          Si ese correo está registrado, te hemos enviado un enlace para elegir una nueva contraseña. Revisa tu bandeja (y la carpeta de spam).
        </p>
        <a href="/login" class="btn-primary" style="width: 100%; display: block; text-align: center; margin-top: 20px; text-decoration: none;">Volver a entrar</a>
      {:else}
        <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: 14px;">
          <p style="font-size: 11px; color: var(--text-muted); line-height: 1.6;">Introduce tu correo y te enviaremos un enlace para restablecer la contraseña.</p>
          <div>
            <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Correo</label>
            <input type="email" bind:value={email} placeholder="tu@correo.com" required autocomplete="email" />
          </div>
          {#if error}<p style="font-size: 10px; color: var(--red);">{error}</p>{/if}
          <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>{loading ? '...' : 'Enviar enlace'}</button>
          <a href="/login" style="font-size: 10px; color: var(--text-muted); text-align: center; text-decoration: none;">Volver</a>
        </form>
      {/if}
    </div>
  </div>
</div>
