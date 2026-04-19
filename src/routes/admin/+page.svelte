<script>
  let { data } = $props();
  let mode = $state(data.mode);
  let saving = $state(false);
  let msg = $state('');
  let searchQuery = $state('');

  const creators = [...data.creators];
  let allUsers = [...data.allUsers];

  let filteredUsers = $derived(
    searchQuery.length < 2 ? []
      : allUsers.filter(u =>
          !creators.find(c => c.id === u.id) &&
          (u.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           u.username.toLowerCase().includes(searchQuery.toLowerCase()))
        ).slice(0, 8)
  );

  async function saveMode() {
    saving = true;
    msg = '';
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'can_create_pools', value: mode }),
      });
      msg = res.ok ? '✓ Guardado' : '✗ Error';
      setTimeout(() => msg = '', 2000);
    } catch { msg = '✗ Error'; }
    saving = false;
  }

  async function addCreator(userId) {
    try {
      const res = await fetch('/api/admin/pool-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (res.ok) {
        const user = allUsers.find(u => u.id === userId);
        if (user) creators.push(user);
        searchQuery = '';
      }
    } catch {}
  }

  async function removeCreator(userId) {
    try {
      const res = await fetch('/api/admin/pool-creators', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (res.ok) {
        const idx = creators.findIndex(c => c.id === userId);
        if (idx >= 0) creators.splice(idx, 1);
      }
    } catch {}
  }
</script>

<div>
  <h1 style="font-size: 20px; color: var(--gold); margin-bottom: 4px;">⚙️ Administración</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Configuración global del sistema</p>

  <!-- Pool Creation Settings -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="font-size: 12px; color: var(--text); font-weight: 600; margin-bottom: 12px;">¿Quién puede crear quinielas?</h2>

    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
      <div onclick={() => mode = 'admin'} style="cursor: pointer; padding: 10px 12px; border-radius: 6px; border: 1px solid {mode === 'admin' ? 'var(--gold)' : 'var(--border)'}; background: {mode === 'admin' ? 'rgba(232,201,106,0.06)' : 'transparent'};">
        <label style="display: block; cursor: pointer;">
          <input type="radio" name="mode" bind:group={mode} value="admin" style="accent-color: var(--gold); vertical-align: middle; margin-right: 6px;" />
          <span style="font-size: 12px; color: var(--text);">Solo administradores y usuarios autorizados</span>
          <br />
          <span style="font-size: 9px; color: var(--text-muted); margin-left: 22px;">Tú decides quién puede crear</span>
        </label>
      </div>
      <div onclick={() => mode = 'anyone'} style="cursor: pointer; padding: 10px 12px; border-radius: 6px; border: 1px solid {mode === 'anyone' ? 'var(--gold)' : 'var(--border)'}; background: {mode === 'anyone' ? 'rgba(232,201,106,0.06)' : 'transparent'};">
        <label style="display: block; cursor: pointer;">
          <input type="radio" name="mode" bind:group={mode} value="anyone" style="accent-color: var(--gold); vertical-align: middle; margin-right: 6px;" />
          <span style="font-size: 12px; color: var(--text);">Cualquiera puede crear</span>
          <br />
          <span style="font-size: 9px; color: var(--text-muted); margin-left: 22px;">Todos los usuarios registrados</span>
        </label>
      </div>
    </div>

    <button class="btn-primary" onclick={saveMode} disabled={saving} style="font-size: 9px; padding: 8px 16px;">
      {saving ? 'Guardando...' : 'Guardar'}
    </button>
    {#if msg}
      <span style="font-size: 11px; color: {msg.startsWith('✓') ? 'var(--green)' : 'var(--red)'}; margin-left: 8px;">{msg}</span>
    {/if}
  </div>

  <!-- Authorized creators (only visible in admin mode) -->
  {#if mode === 'admin'}
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
      <h2 style="font-size: 12px; color: var(--text); font-weight: 600; margin-bottom: 12px;">Usuarios autorizados para crear</h2>

      {#if creators.length > 0}
        <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;">
          {#each creators as creator}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--bg-surface); border-radius: 4px;">
              <span style="font-size: 11px; color: var(--text);">{creator.display_name} <span style="color: var(--text-muted);">(@{creator.username})</span></span>
              <button onclick={() => removeCreator(creator.id)} style="font-size: 9px; color: var(--red); background: none; border: none; cursor: pointer; padding: 4px;">✗</button>
            </div>
          {/each}
        </div>
      {:else}
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">Solo los admins pueden crear quinielas</div>
      {/if}

      <!-- Add user search -->
      <div style="position: relative;">
        <input
          type="text"
          placeholder="Buscar usuario..."
          bind:value={searchQuery}
          style="width: 100%; padding: 8px 12px; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text);"
        />
        {#if filteredUsers.length > 0}
          <div style="position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; margin-top: 2px; z-index: 10; max-height: 200px; overflow-y: auto;">
            {#each filteredUsers as user}
              <button
                onclick={() => addCreator(user.id)}
                style="display: flex; justify-content: space-between; width: 100%; padding: 8px 12px; background: none; border: none; border-bottom: 1px solid var(--border); cursor: pointer; color: var(--text); font-size: 11px;"
              >
                <span>{user.display_name}</span>
                <span style="color: var(--text-muted);">@{user.username}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
