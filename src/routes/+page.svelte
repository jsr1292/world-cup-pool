<script>
  let { data } = $props();
</script>

<div>
  <div style="margin-bottom: 24px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">
      ¡Hola{data.user?.display_name ? ', ' + data.user.display_name : ''}! 👋
    </h1>
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
      Mundial 2026 · {data.daysUntil > 0 ? `${data.daysUntil} días para el mundial` : '¡El mundial ha comenzado!'}
    </p>
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
      <div style="display: grid; gap: 8px;">
        {#each data.pools as pool}
          <a href="/pool/{pool.id}" style="display: block; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; transition: border-color 0.15s; text-decoration: none;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text);">{pool.name}</div>
                <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
                  {pool.member_count} miembro{pool.member_count !== 1 ? 's' : ''}
                  {pool.buy_in > 0 ? ` · ${pool.buy_in}€` : ''}
                </div>
              </div>
              <div style="text-align: right;">
                {#if pool.has_paid}
                  <span style="font-size: 9px; color: var(--green); letter-spacing: 0.1em; text-transform: uppercase;">✓ Pagado</span>
                {:else if pool.buy_in > 0}
                  <span style="font-size: 9px; color: var(--gold); letter-spacing: 0.1em; text-transform: uppercase;">Pendiente</span>
                {/if}
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Quick Stats -->
  <section>
    <h2 style="font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px;">Estadísticas</h2>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: var(--gold);">{data.pools.length}</div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Quinielas</div>
      </div>
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: var(--gold);">48</div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Selecciones</div>
      </div>
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: var(--gold);">104</div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Partidos</div>
      </div>
    </div>
  </section>
</div>
