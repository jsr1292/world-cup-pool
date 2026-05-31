<script>
  import { page } from '$app/stores';

  let password = $state('');
  let confirm = $state('');
  let done = $state(false);
  let error = $state('');
  let loading = $state(false);

  const token = $derived($page.url.searchParams.get('token') || '');

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';
    if (password.length < 6) { error = 'La contraseña debe tener al menos 6 caracteres'; return; }
    if (password !== confirm) { error = 'Las contraseñas no coinciden'; return; }
    loading = true;
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        done = true;
      } else {
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
        <div style="font-size: 40px; margin-bottom: 8px;">🔒</div>
        <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">Nueva contraseña</h1>
      </div>

      {#if done}
        <p style="font-size: 12px; color: var(--text-muted); text-align: center; line-height: 1.6;">Tu contraseña se ha actualizado. Ya puedes entrar con la nueva.</p>
        <a href="/login" class="btn-primary" style="width: 100%; display: block; text-align: center; margin-top: 20px; text-decoration: none;">Entrar</a>
      {:else if !token}
        <p style="font-size: 12px; color: var(--red); text-align: center;">Enlace inválido. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".</p>
        <a href="/forgot" class="btn-primary" style="width: 100%; display: block; text-align: center; margin-top: 20px; text-decoration: none;">Pedir enlace</a>
      {:else}
        <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Nueva contraseña</label>
            <input type="password" bind:value={password} placeholder="••••••••" required autocomplete="new-password" />
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.12em; text-transform: uppercase;">Confirmar</label>
            <input type="password" bind:value={confirm} placeholder="••••••••" required autocomplete="new-password" />
          </div>
          {#if error}<p style="font-size: 10px; color: var(--red);">{error}</p>{/if}
          <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>{loading ? '...' : 'Guardar contraseña'}</button>
        </form>
      {/if}
    </div>
  </div>
</div>
