<script lang="ts">
  let { data } = $props();
  import { flagEmoji, shortName } from '$lib/teams.js';

  function teamName(id: number) { const n = data.teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function teamFlag(id: number) { return flagEmoji(data.teams[id]?.flag_code || ''); }
  const pct = (c: number) => data.totalEntries > 0 ? Math.round((c / data.totalEntries) * 100) : 0;

  const groupOrder = $derived(Object.keys(data.groupWinners ?? {}).sort());
  // The single most-picked champion, for the headline fun-fact.
  const topChampion = $derived(data.champions?.[0] ?? null);
</script>

<svelte:head><title>Estadísticas · {data.pool.name}</title></svelte:head>

<div style="max-width: 560px; margin: 0 auto; padding: 16px;">
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 12px;">← {data.pool.name}</a>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 4px;">📊 Estadísticas</h1>

  {#if !data.betsLocked}
    <div style="margin-top: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">Las estadísticas se mostrarán cuando se cierren las apuestas, para que nadie pueda copiar al resto.</p>
    </div>
  {:else if data.totalEntries === 0}
    <p style="font-size: 12px; color: var(--text-muted); margin-top: 16px;">Aún no hay pronósticos en esta quiniela.</p>
  {:else}
    <p style="font-size: 11px; color: var(--text-muted); margin: 4px 0 18px;">
      Lo que ha votado el grupo · <strong style="color: var(--text);">{data.totalEntries}</strong> {data.totalEntries === 1 ? 'pronóstico' : 'pronósticos'}.
      {#if topChampion}<br>El favorito al título es <strong style="color: var(--gold);">{teamName(topChampion.team_id)}</strong> ({pct(topChampion.c)}%).{/if}
    </p>

    {#snippet barList(rows: { team_id: number; c: number }[], accent: string, limit = 99)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        {#each rows.slice(0, limit) as row}
          <div style="position: relative; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
            <div style="position: absolute; inset: 0 auto 0 0; width: {pct(row.c)}%; background: {accent}; opacity: 0.16;"></div>
            <div style="position: relative; display: flex; align-items: center; gap: 8px; padding: 8px 10px;">
              <span style="font-size: 15px;">{@html teamFlag(row.team_id)}</span>
              <span style="flex: 1; font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{teamName(row.team_id)}</span>
              <span style="font-size: 11px; color: var(--text-muted);">{row.c}</span>
              <span style="font-size: 12px; font-weight: 700; color: {accent}; min-width: 34px; text-align: right;">{pct(row.c)}%</span>
            </div>
          </div>
        {/each}
      </div>
    {/snippet}

    <!-- Champions -->
    <section style="margin-bottom: 26px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🏆 Campeón más votado</h2>
      {#if data.champions.length > 0}
        {@render barList(data.champions, 'var(--gold)', 10)}
      {:else}
        <p style="font-size: 11px; color: var(--text-muted);">Nadie ha elegido campeón todavía.</p>
      {/if}
    </section>

    <!-- Finalists -->
    <section style="margin-bottom: 26px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">🥈 Más votados para llegar a la final</h2>
      <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px;">Cada pronóstico elige 2 finalistas, así que los % pueden sumar más de 100.</p>
      {#if data.finalists.length > 0}
        {@render barList(data.finalists, 'var(--green)', 10)}
      {:else}
        <p style="font-size: 11px; color: var(--text-muted);">Sin finalistas elegidos todavía.</p>
      {/if}
    </section>

    <!-- Group winners -->
    <section style="margin-bottom: 20px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🥇 Ganador de cada grupo</h2>
      <div style="display: flex; flex-direction: column; gap: 14px;">
        {#each groupOrder as g}
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 5px;">Grupo {g}</div>
            {@render barList(data.groupWinners[g], 'var(--gold)', 4)}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
