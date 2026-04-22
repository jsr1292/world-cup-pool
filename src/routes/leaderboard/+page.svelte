<script lang="ts">
  let { data } = $props();
  const { leaderboard } = data;

  // Pull-to-refresh
  let ptrStartY = 0;
  let ptrPull = $state(0);
  let ptrRefreshing = $state(false);

  function onPtrTouchStart(e: TouchEvent) {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) return;
    ptrStartY = e.touches[0].clientY;
  }
  function onPtrTouchMove(e: TouchEvent) {
    if (ptrStartY === 0 || ptrRefreshing) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy < 0) { ptrStartY = 0; ptrPull = 0; return; }
    ptrPull = Math.min(dy, 80);
  }
  function onPtrTouchEnd() {
    if (ptrPull >= 50 && !ptrRefreshing) {
      ptrRefreshing = true;
      window.location.reload();
    } else {
      ptrPull = 0;
    }
    ptrStartY = 0;
  }
</script>

<div
  style="overscroll-behavior-y: contain;"
  ontouchstart={onPtrTouchStart}
  ontouchmove={onPtrTouchMove}
  ontouchend={onPtrTouchEnd}
>
  <!-- Pull-to-refresh indicator -->
  <div style="position: sticky; top: calc(56px + env(safe-area-inset-top)); z-index: 20; text-align: center; padding: 8px 0; pointer-events: none; transition: opacity 0.2s; opacity: {ptrPull > 10 ? 1 : 0};">
    <span style="font-size: 12px; color: var(--gold); {ptrRefreshing ? 'display:inline-block;animation:spin 0.8s linear infinite;' : ''}">
      {ptrRefreshing ? '↻ Refreshing...' : ptrPull >= 50 ? '↻ Suelta para actualizar' : '↻'}
    </span>
  </div>

  <div style="margin-bottom: 24px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">🏆 Clasificación Global</h1>
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
      Los mejores pronosticadores del mundial
    </p>
  </div>

  {#if data.leaderboard == null}
    <!-- Skeleton -->
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
      <div style="display: grid; grid-template-columns: 40px 1fr 60px 60px; padding: 10px 16px; font-size: 8px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--border);">
        <div>#</div><div>Usuario</div><div style="text-align: right;">Pts</div><div style="text-align: right;">Aciertos</div>
      </div>
      {#each [1,2,3,4,5,6] as _}
        <div style="display: grid; grid-template-columns: 40px 1fr 70px 60px; padding: 12px 16px; border-bottom: 1px solid var(--border); align-items: center;">
          <div class="skeleton skeleton-circle"></div>
          <div>
            <div class="skeleton skeleton-text medium" style="width: 120px;"></div>
            <div class="skeleton skeleton-text short" style="margin-top: 6px; width: 80px;"></div>
          </div>
          <div class="skeleton" style="height: 20px; width: 32px; margin-left: auto;"></div>
          <div class="skeleton" style="height: 20px; width: 24px; margin-left: auto;"></div>
        </div>
      {/each}
    </div>
  {:else if leaderboard.length === 0}
    <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
      <div style="font-size: 40px; margin-bottom: 12px;">🏆</div>
      <p style="font-size: 13px;">Aún no hay predicciones registradas.</p>
      <p style="font-size: 11px; margin-top: 8px;">¡Únete a una quiniela y empieza a ganar!</p>
      <a href="/login" class="btn-primary" style="display: inline-block; margin-top: 20px; font-size: 11px; padding: 10px 24px;">Iniciar sesión</a>
    </div>
  {:else}
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
      <div style="display: grid; grid-template-columns: 40px 1fr 60px 60px; padding: 10px 16px; font-size: 8px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--border);">
        <div>#</div>
        <div>Usuario</div>
        <div style="text-align: right;">Pts</div>
        <div style="text-align: right;">Aciertos</div>
      </div>
      {#each leaderboard as entry}
        <div style="display: grid; grid-template-columns: 40px 1fr 70px 60px; padding: 12px 16px; font-size: 12px; border-bottom: 1px solid var(--border); align-items: center;" class:gold={entry.rank === 1} class:silver={entry.rank === 2} class:bronze={entry.rank === 3}>
          <div style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; {entry.rank === 1 ? 'background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e;' : entry.rank === 2 ? 'background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e;' : entry.rank === 3 ? 'background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e;' : 'background: rgba(255,255,255,0.06); color: var(--text-dim);'}">
            {entry.display_name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div style="font-weight: 600; color: var(--text);">{entry.display_name}</div>
            <div style="font-size: 9px; color: var(--text-muted);">@{entry.username} · {entry.pools_count} quiniela{entry.pools_count !== 1 ? 's' : ''}</div>
          </div>
          <div style="text-align: right; font-weight: 700; color: var(--gold); font-size: 14px;">{entry.total_score}</div>
          <div style="text-align: right; color: var(--text-muted); font-size: 11px;">{entry.total_correct}</div>
        </div>
      {/each}
    </div>
  {/if}

  <div style="margin-top: 16px; text-align: center;">
    <a href="/pools" style="font-size: 10px; color: var(--text-muted);">Ver mis pools →</a>
  </div>
</div>

<style>
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .gold { background: rgba(201, 168, 76, 0.06); }
  .silver { background: rgba(192, 192, 192, 0.04); }
  .bronze { background: rgba(205, 127, 50, 0.04); }
</style>
