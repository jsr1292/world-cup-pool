<script lang="ts">
  import PullToRefresh from '$lib/components/PullToRefresh.svelte';
  let { data } = $props();
  const { leaderboard } = data;
</script>

<PullToRefresh onRefresh={async () => { window.location.reload(); }}>
  <div style="margin-bottom: 24px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold);">🏆 Clasificación Global</h1>
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
      Los mejores pronosticadores del mundial
    </p>
  </div>

  {#if data.leaderboard == null}
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
      <div style="display: grid; grid-template-columns: 40px 1fr 50px 40px 40px; padding: 10px 16px; font-size: 8px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--border);">
        <div>#</div><div>Usuario</div><div style="text-align: right;">Pts</div><div style="text-align: right;">Exactos</div><div style="text-align: right;">Ac.</div>
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
        <div style="display: grid; grid-template-columns: 40px 1fr 50px 40px 40px; padding: 12px 16px; font-size: 12px; border-bottom: 1px solid var(--border); align-items: center; {entry.user_id === data.currentUserId ? 'background: rgba(201,168,76,0.08); border-left: 3px solid var(--gold);' : ''}" class:gold={entry.rank === 1 && entry.user_id !== data.currentUserId} class:silver={entry.rank === 2 && entry.user_id !== data.currentUserId} class:bronze={entry.rank === 3 && entry.user_id !== data.currentUserId} class:me={entry.user_id === data.currentUserId}>
          <div style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; {entry.rank === 1 ? 'background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e;' : entry.rank === 2 ? 'background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e;' : entry.rank === 3 ? 'background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e;' : 'background: rgba(255,255,255,0.06); color: var(--text-dim);'}">
            {entry.display_name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div style="font-weight: 600; color: var(--text);">{entry.display_name}</div>
            <div style="font-size: 9px; color: var(--text-muted);">@{entry.username} · {entry.pools_count} quiniela{entry.pools_count !== 1 ? 's' : ''}</div>
          </div>
          <div style="text-align: right; font-weight: 700; color: var(--gold); font-size: 14px;">{entry.total_score}</div>
          <div style="text-align: right; color: var(--green); font-size: 11px; font-weight: 600;" title="Marcadores exactos">{entry.exact_score_hits || 0}</div>
          <div style="text-align: right; color: var(--text-muted); font-size: 11px;">{entry.total_correct || 0}</div>
        </div>
      {/each}
    </div>
  {/if}

  <div style="margin-top: 16px; text-align: center;">
    <a href="/pools" style="font-size: 10px; color: var(--text-muted);">Ver mis pools →</a>
  </div>
</PullToRefresh>

<style>
  .gold { background: rgba(201, 168, 76, 0.06); }
  .silver { background: rgba(192, 192, 192, 0.04); }
  .bronze { background: rgba(205, 127, 50, 0.04); }
</style>
