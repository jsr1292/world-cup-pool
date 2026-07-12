<script lang="ts">
  let { data } = $props();
  import { flagEmoji, shortName } from '$lib/teams.js';

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  const groupWinners = $derived(data.groupWinners as Record<string, { team_id: number; c: number }[]>);
  function teamName(id: number) { const n = teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function teamFlag(id: number) { return flagEmoji(teams[id]?.flag_code || ''); }
  const pct = (c: number) => data.totalEntries > 0 ? Math.round((c / data.totalEntries) * 100) : 0;

  let showCrowdHelp = $state(false);

  const groupOrder = $derived(Object.keys(groupWinners ?? {}).sort());
  // The single most-picked champion, for the headline fun-fact.
  const topChampion = $derived(data.champions?.[0] ?? null);
  // Dark horse: the least-backed champion pick (a contrarian title call).
  const darkHorse = $derived.by(() => {
    const cs = data.champions ?? [];
    if (cs.length < 2) return null;
    const min = cs[cs.length - 1];
    // Only interesting if it's genuinely a minority pick.
    return min.c <= Math.max(1, Math.floor(data.totalEntries * 0.1)) ? min : null;
  });

  function fmtMatchDate(ts: string | null): string {
    if (!ts) return 'Fecha por confirmar';
    return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // Full per-match breakdown (server-sorted by kickoff) bucketed by date.
  const breakdownByDate = $derived.by((): [string, any[]][] => {
    const out: [string, any[]][] = [];
    let cur: [string, any[]] | null = null;
    for (const m of ((data.matchBreakdown as any[]) || [])) {
      const label = fmtMatchDate(m.kickoff);
      if (!cur || cur[0] !== label) { cur = [label, []]; out.push(cur); }
      cur[1].push(m);
    }
    return out;
  });
</script>

<svelte:head><title>Estadísticas · {data.pool.name}</title></svelte:head>

<div style="max-width: 1000px; margin: 0 auto;">
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
      {#if darkHorse}<br>🐴 Caballo negro: <strong style="color: var(--text);">{teamName(darkHorse.team_id)}</strong> — {darkHorse.c === 1 ? 'solo 1 lo ve' : `solo ${darkHorse.c} lo ven`} campeón.{/if}
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

    <!-- One solid stacked bar for a match's 1/X/2 vote split. Once played, the
         losing segments dim and the real outcome gets a green ring + ✓. -->
    {#snippet voteBar(d: any)}
      {@const tot = d.total || 1}
      {@const segs = [
        { k: '1', n: d.p1, color: 'var(--gold)', fg: '#1a1a2e' },
        { k: 'X', n: d.px, color: '#5b6472', fg: '#ffffff' },
        { k: '2', n: d.p2, color: '#4f9cf0', fg: '#0b1220' },
      ]}
      <div style="display: flex; height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: var(--bg-card);">
        {#each segs as s}
          {@const share = Math.round((Number(s.n) / tot) * 100)}
          {@const won = d.finished && d.actual === s.k}
          <div title="{s.k}: {s.n} ({share}%){won ? ' · resultado real' : ''}" style="width: {share}%; background: {s.color}; opacity: {d.finished && !won ? 0.32 : 1}; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: {won ? 'inset 0 0 0 2px var(--green)' : 'none'};">
            {#if share >= 12}
              <span style="font-size: 9px; font-weight: 700; color: {s.fg}; white-space: nowrap;">{s.k} {share}%{#if won} ✓{/if}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/snippet}

    <!-- Champions -->
    <!-- Champions + Finalists: side-by-side on desktop -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 20px; align-items: start;">
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
    </div>

    <!-- Most divisive matches -->
    {#if data.divisive.length > 0}
      <section style="margin-bottom: 26px;">
        <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">🔥 Partidos más reñidos</h2>
        <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px;">Donde el grupo está más dividido (1 = gana local · X = empate · 2 = gana visitante).</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; align-items: start;">
          {#each data.divisive as d}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 7px; padding: 9px 11px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 7px;">
                <span>{@html teamFlag(d.home)}</span><span style="font-weight: 500;">{teamName(d.home)}</span>
                <span style="color: var(--text-dim);">vs</span>
                <span>{@html teamFlag(d.away)}</span><span style="font-weight: 500;">{teamName(d.away)}</span>
              </div>
              {@render voteBar(d)}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- With the crowd / contrarian -->
    {#if data.mainstream.length > 0}
      <section style="margin-bottom: 26px;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 0;">🎲 Estilo de apuesta</h2>
          <button onclick={() => showCrowdHelp = !showCrowdHelp} aria-label="¿Qué significa?" style="width: 17px; height: 17px; border-radius: 50%; border: 1px solid var(--border); background: none; color: var(--text-muted); font-size: 10px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; flex-shrink: 0;">?</button>
        </div>
        {#if showCrowdHelp}
          <div style="font-size: 10px; color: var(--text-muted); line-height: 1.5; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; margin-bottom: 10px;">
            Para cada partido de grupos miramos la opción <strong>más votada</strong> por el grupo (1/X/2). Tu % es las veces que coincidiste con esa mayoría.<br>
            <strong style="color: var(--gold);">🐑 Con el grupo</strong>: quienes más apuestan como la mayoría · <strong>🦄 Más contrarios</strong>: quienes más se salen de lo común.<br>
            Es una sola clasificación para toda la quiniela (igual para todos) y <strong>no mide aciertos</strong> — solo si vas con la corriente o a contracorriente.
          </div>
        {/if}
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <h2 style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 8px;">🐑 Con el grupo</h2>
            <div style="display: flex; flex-direction: column; gap: 5px;">
              {#each data.mainstream as e}
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px;">
                  <div style="font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.name}{#if e.label} · {e.label}{/if}</div>
                  <div style="font-size: 13px; font-weight: 700; color: var(--gold);">{Math.round(e.pct * 100)}%</div>
                </div>
              {/each}
            </div>
          </div>
          <div>
            <h2 style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 8px;">🦄 Más contrarios</h2>
            <div style="display: flex; flex-direction: column; gap: 5px;">
              {#each data.contrarian as e}
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px;">
                  <div style="font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.name}{#if e.label} · {e.label}{/if}</div>
                  <div style="font-size: 13px; font-weight: 700; color: var(--text-muted);">{Math.round(e.pct * 100)}%</div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Full per-match breakdown, chronological -->
    {#if data.matchBreakdown && data.matchBreakdown.length > 0}
      <section style="margin-bottom: 26px;">
        <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">📅 Desglose por partido</h2>
        <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px;">Cómo votó el grupo en cada partido, en orden cronológico (1 = gana local · X = empate · 2 = gana visitante). ✓ marca el resultado real.</p>
        {#each breakdownByDate as [dateLabel, ms]}
          <div style="font-size: 9px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 5px;">{dateLabel}</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; align-items: start;">
            {#each ms as d}
              <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 7px; padding: 9px 11px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 7px;">
                  <span style="font-size: 8px; color: var(--text-dim); flex-shrink: 0;">{d.group_name}</span>
                  <span>{@html teamFlag(d.home)}</span><span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{teamName(d.home)}</span>
                  <span style="color: var(--text-dim);">vs</span>
                  <span>{@html teamFlag(d.away)}</span><span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{teamName(d.away)}</span>
                  {#if d.finished}<span style="margin-left: auto; flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--gold);">{d.home_score}-{d.away_score}</span>{/if}
                </div>
                {@render voteBar(d)}
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    <!-- Group winners -->
    <section style="margin-bottom: 20px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🥇 Ganador de cada grupo</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px 16px; align-items: start;">
        {#each groupOrder as g}
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 5px;">Grupo {g}</div>
            {@render barList(groupWinners[g], 'var(--gold)', 4)}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
