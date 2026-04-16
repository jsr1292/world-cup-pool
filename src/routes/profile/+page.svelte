<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let changing = $state(false);
  let changeResult = $state(null) as { ok: boolean; msg: string } | null;

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      changeResult = { ok: false, msg: 'Las contraseñas no coinciden' };
      return;
    }
    if (newPassword.length < 4) {
      changeResult = { ok: false, msg: 'Mínimo 4 caracteres' };
      return;
    }
    changing = true;
    changeResult = null;
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const d = await res.json();
      if (d.ok) {
        changeResult = { ok: true, msg: 'Contraseña actualizada' };
        currentPassword = '';
        newPassword = '';
        confirmPassword = '';
      } else {
        changeResult = { ok: false, msg: d.error || 'Error' };
      }
    } catch {
      changeResult = { ok: false, msg: 'Error de conexión' };
    }
    changing = false;
  }
</script>

<div>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Perfil</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Ajustes de cuenta</p>

  <!-- User Info -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Usuario</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.username}</div>
      </div>
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Nombre</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.display_name}</div>
      </div>
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Miembro desde</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.created_at}</div>
      </div>
    </div>
  </div>

  <!-- Change Password -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 16px;">🔐 Cambiar contraseña</div>

    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Contraseña actual</label>
        <input type="password" bind:value={currentPassword} placeholder="••••••••" />
      </div>
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Nueva contraseña</label>
        <input type="password" bind:value={newPassword} placeholder="••••••••" />
      </div>
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Confirmar contraseña</label>
        <input type="password" bind:value={confirmPassword} placeholder="••••••••" />
      </div>

      {#if changeResult}
        <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: {changeResult.ok ? 'rgba(0,229,160,0.1)' : 'rgba(255,77,106,0.1)'}; color: {changeResult.ok ? 'var(--green)' : 'var(--red)'};">
          {changeResult.msg}
        </div>
      {/if}

      <button class="btn-primary" onclick={changePassword} disabled={changing || !currentPassword || !newPassword || !confirmPassword}>
        {changing ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </div>
  </div>

  <!-- Logout -->
  <form method="POST" action="/api/auth/logout">
    <button type="submit" class="btn-ghost" style="width: 100%;">Cerrar sesión</button>
  </form>
</div>
