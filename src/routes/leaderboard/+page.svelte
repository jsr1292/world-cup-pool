<script lang="ts">
  let { data } = $props();
  const { leaderboard } = data;
</script>

<div>
  <div style="margin-bottom: 24px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">🏆 Clasificación Global</h1>
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
      Los mejores pronosticadores del mundial
    </p>
  </div>

  {#if leaderboard.length === 0}
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
        <div style="text-align: right;">Puntos</div>
        <div style="text-align: right;">Aciertos</div>
      </div>
      {#each leaderboard as entry}
        <div style="display: grid; grid-template-columns: 40px 1fr 60px 60px; padding: 12px 16px; font-size: 12px; border-bottom: 1px solid var(--border); align-items: center;" class:gold={entry.rank === 1} class:silver={entry.rank === 2} class:bronze={entry.rank === 3}>
          <div style="font-size: 14px;">
            {#if entry.rank === 1}🥇
            {:else if entry.rank === 2}🥈
            {:else if entry.rank === 3}🥉
            {:else}{entry.rank}{/if}
          </div>
          <div>
            <div style="font-weight: 600; color: var(--text);">{entry.display_name}</div>
            <div style="font-size: 9px; color: var(--text-muted);">@{entry.username} · {entry.pools_count} quiniela{entry.pools_count !== 1 ? 's' : ''}</div>
          </div>
          <div style="text-align: right; font-weight: 700; color: var(--gold);">{entry.total_score}</div>
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
  .gold { background: rgba(201, 168, 76, 0.06); }
  .silver { background: rgba(192, 192, 192, 0.04); }
  .bronze { background: rgba(205, 127, 50, 0.04); }
</style>
