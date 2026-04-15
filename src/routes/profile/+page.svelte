<script>
  let { data } = $props();
</script>

<div>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Perfil</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Ajustes de cuenta</p>

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

  <form method="POST" action="/api/auth/logout">
    <button type="submit" class="btn-ghost" style="width: 100%;">Cerrar sesión</button>
  </form>
</div>
