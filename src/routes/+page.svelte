<script>
  let { data } = $props();
</script>

<div>
  <!-- Hero Banner -->
  <div style="margin-bottom: 32px; padding: 36px 28px; background: linear-gradient(135deg, rgba(201,168,76,0.12) 0%, rgba(201,168,76,0.03) 100%); border-radius: 16px; border: 1px solid rgba(201,168,76,0.15);">
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
      <div>
        <h1 style="font-family: 'Libre Baskerville', serif; font-size: 28px; color: var(--gold); margin-bottom: 4px;">
          ¡Hola{data.user?.display_name ? ', ' + data.user.display_name : ''}! 👋
        </h1>
        <p style="font-size: 12px; color: var(--text-muted);">
          Mundial 2026 · {data.daysUntil > 0 ? `<span style="color: var(--gold); font-weight: 600;">${data.daysUntil} días</span> para el mundial` : '¡El mundial ha comenzado!'}
        </p>
      </div>
      <div style="display: flex; gap: 8px;">
        <a href="/pools/create" class="btn-primary" style="font-size: 10px; padding: 10px 20px; text-decoration: none;">+ Nueva Quiniela</a>
        <a href="/join" class="btn-ghost" style="font-size: 10px; padding: 10px 20px; text-decoration: none;">Unirse</a>
      </div>
    </div>
  </div>

  <!-- My Pools -->
  <section style="margin-bottom: 24px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h2 style="font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted);">Mis Quinielas</h2>
      <a href="/pools/create" class="btn-primary" style="font-size: 9px; padding: 6px 14px;">+ Nueva</a>
    </div>

    {#if data.pools.length === 0}
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 32px; text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">🏆</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Sin quinielas aún. ¡Crea una o únete con un código!</p>
        <div style="display: flex; gap: 8; justify-content: center;">
          <a href="/pools/create" class="btn-primary" style="font-size: 9px; padding: 8px 16px;">Crear</a>
          <a href="/join" class="btn-ghost" style="font-size: 9px; padding: 8px 16px;">Unirse</a>
        </div>
      </div>
    {:else}
      <div class="pool-grid">
        {#each data.pools as pool}
          <a href="/pool/{pool.id}" class="pool-card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="flex: 1;">
                <div class="pool-card-name">{pool.name}</div>
                <div class="pool-card-meta">
                  👥 {pool.member_count} miembro{pool.member_count !== 1 ? 's' : ''}
                  {pool.buy_in > 0 ? ` · 💰 ${pool.buy_in}€` : ''}
                </div>
              </div>
              <div style="font-size: 24px; margin-left: 12px;">🏆</div>
            </div>
            <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
              {#if pool.has_paid}
                <span class="badge badge-green">✓ Pagado</span>
              {:else if pool.buy_in > 0}
                <span class="badge badge-gold">Pendiente</span>
              {:else}
                <span class="badge">Gratis</span>
              {/if}
              <span style="font-size: 10px; color: var(--gold);">Ver →</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Quick Stats -->
  <section>
    <h2 style="font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px;">Datos del torneo</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{data.pools.length}</div>
        <div class="stat-label">Quinielas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">48</div>
        <div class="stat-label">Selecciones</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">104</div>
        <div class="stat-label">Partidos</div>
      </div>
    </div>
  </section>
</div>
