<script>
  let { data } = $props();
</script>

<div>
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold);">
      {data.pools.length === 0 ? '¡Bienvenido!' : 'Mis Quinielas'}
    </h1>
    <div style="display: flex; gap: 8px;">
      <a href="/join" class="btn-ghost" style="font-size: 9px; padding: 6px 14px;">Unirse</a>
      {#if data.canCreate}
        <a href="/pools/create" class="btn-primary" style="font-size: 9px; padding: 6px 14px;">+ Crear</a>
      {/if}
    </div>
  </div>

  {#if data.pools.length === 0}
    <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
      <div style="font-size: 40px; margin-bottom: 12px;">🏆</div>
      <p style="font-size: 13px; margin-bottom: 16px;">Aún no estás en ninguna quiniela</p>
      <div style="display: flex; gap: 8px; justify-content: center;">
        {#if data.canCreate}
          <a href="/pools/create" class="btn-primary" style="font-size: 9px; padding: 8px 16px;">Crear quiniela</a>
        {/if}
        <a href="/join" class="btn-ghost" style="font-size: 9px; padding: 8px 16px;">Unirse</a>
      </div>
    </div>
  {:else}
    <div style="display: grid; gap: 8px;">
      {#each data.pools as pool}
        <a href="/pool/{pool.id}" style="display: block; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-decoration: none; transition: border-color 0.15s;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: var(--text);">{pool.name}</div>
              <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;">
                {pool.member_count} miembro{pool.member_count !== 1 ? 's' : ''}
                {pool.buy_in > 0 ? ` · ${pool.buy_in}€` : ''}
                {#if pool.is_active}
                  <span style="color: var(--green);"> · Activa</span>
                {/if}
              </div>
            </div>
            <div style="text-align: right;">
              {#if pool.has_paid}
                <span style="font-size: 9px; color: var(--green);">✓</span>
              {:else if pool.buy_in > 0}
                <span style="font-size: 9px; color: var(--gold);">Pendiente</span>
              {/if}
              <div style="font-size: 9px; color: var(--text-dim); margin-top: 2px;">Código: {pool.invite_code}</div>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
