<script lang="ts">
  let { data } = $props();
  import { flagEmoji, shortName } from '$lib/teams.js';

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  const groupWinners = $derived(data.groupWinners as Record<string, { team_id: number; c: number }[]>);
  function teamName(id: number) { const n = teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function teamFlag(id: number) { return flagEmoji(teams[id]?.flag_code || ''); }
  const pct = (c: number) => data.totalEntries > 0 ? Math.round((c / data.totalEntries) * 100) : 0;

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

    <!-- Most divisive matches -->
    {#if data.divisive.length > 0}
      <section style="margin-bottom: 26px;">
        <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">🔥 Partidos más reñidos</h2>
        <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px;">Donde el grupo está más dividido (1 = gana local · X = empate · 2 = gana visitante).</p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          {#each data.divisive as d}
            {@const tot = d.total || 1}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 7px; padding: 9px 11px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 7px;">
                <span>{@html teamFlag(d.home)}</span><span style="font-weight: 500;">{teamName(d.home)}</span>
                <span style="color: var(--text-dim);">vs</span>
                <span>{@html teamFlag(d.away)}</span><span style="font-weight: 500;">{teamName(d.away)}</span>
              </div>
              <div style="display: flex; gap: 4px; font-size: 9px;">
                {#each [['1', d.p1], ['X', d.px], ['2', d.p2]] as [k, n]}
                  {@const share = Math.round((Number(n) / tot) * 100)}
                  <div style="flex: 1; text-align: center;">
                    <div style="height: 5px; border-radius: 3px; background: {d.finished && d.actual === k ? 'var(--green)' : 'var(--gold)'}; opacity: {d.finished && d.actual === k ? 0.9 : 0.5}; width: {Math.max(share, 3)}%; margin: 0 auto 3px; min-width: 4px;"></div>
                    <span style="color: {d.finished && d.actual === k ? 'var(--green)' : 'var(--text-muted)'}; font-weight: {d.finished && d.actual === k ? '700' : '400'};">{k} {share}%{#if d.finished && d.actual === k} ✓{/if}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- With the crowd / contrarian -->
    {#if data.mainstream.length > 0}
      <section style="margin-bottom: 26px;">
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
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 8px;">% de partidos de grupo en los que coincidiste con la opción más votada del grupo.</p>
      </section>
    {/if}

    <!-- Full per-match breakdown, chronological -->
    {#if data.matchBreakdown && data.matchBreakdown.length > 0}
      <section style="margin-bottom: 26px;">
        <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">📅 Desglose por partido</h2>
        <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px;">Cómo votó el grupo en cada partido, en orden cronológico (1 = gana local · X = empate · 2 = gana visitante). ✓ marca el resultado real.</p>
        {#each breakdownByDate as [dateLabel, ms]}
          <div style="font-size: 9px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 5px;">{dateLabel}</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            {#each ms as d}
              {@const tot = d.total || 1}
              <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 7px; padding: 9px 11px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 7px;">
                  <span style="font-size: 8px; color: var(--text-dim); flex-shrink: 0;">{d.group_name}</span>
                  <span>{@html teamFlag(d.home)}</span><span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{teamName(d.home)}</span>
                  <span style="color: var(--text-dim);">vs</span>
                  <span>{@html teamFlag(d.away)}</span><span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{teamName(d.away)}</span>
                  {#if d.finished}<span style="margin-left: auto; flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--gold);">{d.home_score}-{d.away_score}</span>{/if}
                </div>
                <div style="display: flex; gap: 4px; font-size: 9px;">
                  {#each [['1', d.p1], ['X', d.px], ['2', d.p2]] as [k, n]}
                    {@const share = Math.round((Number(n) / tot) * 100)}
                    <div style="flex: 1; text-align: center;">
                      <div style="height: 5px; border-radius: 3px; background: {d.finished && d.actual === k ? 'var(--green)' : 'var(--gold)'}; opacity: {d.finished && d.actual === k ? 0.9 : 0.5}; width: {Math.max(share, 3)}%; margin: 0 auto 3px; min-width: 4px;"></div>
                      <span style="color: {d.finished && d.actual === k ? 'var(--green)' : 'var(--text-muted)'}; font-weight: {d.finished && d.actual === k ? '700' : '400'};">{k} {share}%{#if d.finished && d.actual === k} ✓{/if}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    <!-- Group winners -->
    <section style="margin-bottom: 20px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🥇 Ganador de cada grupo</h2>
      <div style="display: flex; flex-direction: column; gap: 14px;">
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
