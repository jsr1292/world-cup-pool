<script lang="ts">
  import { goto } from '$app/navigation';
  import { flagEmoji, shortName } from '$lib/teams.js';
  let { data } = $props();

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  function tName(id: number | null) { const n = id != null ? teams[id]?.name : null; return n ? shortName(n) : '—'; }
  function tFlag(id: number | null) { return id != null ? flagEmoji(teams[id]?.flag_code || '') : ''; }
  const entryLabel = (e: any) => `${e.display_name}${data.pool.allow_multiple_predictions && e.label ? ` · ${e.label}` : ''}`;

  function catLabel(c: string): string {
    return c === 'posicion' ? 'Posición (tabla)' : c === 'eliminatorias' ? 'Eliminatorias' : 'Resultados 1/X/2';
  }

  let aSel = $state(data.a?.id ? String(data.a.id) : '');
  let bSel = $state(data.b?.id ? String(data.b.id) : '');
  function reload() { if (aSel && bSel && aSel !== bSel) goto(`?a=${aSel}&b=${bSel}`, { invalidateAll: true }); }

  const groups = 'ABCDEFGHIJKL'.split('');
  // Agreement count across champion + group winners (the comparable single-pick fields).
  const agreement = $derived.by(() => {
    if (!data.a || !data.b) return null;
    let same = 0, total = 0;
    total++; if (data.a.champion != null && data.a.champion === data.b.champion) same++;
    for (const g of groups) { total++; const av = data.a.groupWinners[g], bv = data.b.groupWinners[g]; if (av != null && av === bv) same++; }
    return { same, total };
  });
  const sharedFinalists = $derived.by(() => {
    if (!data.a || !data.b) return 0;
    const bs = new Set(data.b.finalists);
    return data.a.finalists.filter((t: number) => bs.has(t)).length;
  });

  function fmtMatchDate(ts: string | null): string {
    if (!ts) return 'Fecha por confirmar';
    return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // Group fixtures (already chronological from the server) bucketed by date.
  const matchesByDate = $derived.by((): [string, any[]][] => {
    const out: [string, any[]][] = [];
    let cur: [string, any[]] | null = null;
    for (const m of (data.groupMatches || [])) {
      const label = fmtMatchDate(m.kickoff_time);
      if (!cur || cur[0] !== label) { cur = [label, []]; out.push(cur); }
      cur[1].push(m);
    }
    return out;
  });
  // How often the two agree on the group-match 1/X/2 (only matches both picked).
  const groupAgreement = $derived.by(() => {
    if (!data.a || !data.b) return null;
    let same = 0, total = 0;
    for (const m of (data.groupMatches || [])) {
      const ac = data.a.groupPicks?.[m.id], bc = data.b.groupPicks?.[m.id];
      if (ac && bc) { total++; if (ac === bc) same++; }
    }
    return { same, total };
  });
  // Actual 1/X/2 outcome of a finished match (null while unplayed).
  function actualCode(m: any): '1' | 'X' | '2' | null {
    if (m.status !== 'finished' || m.home_score == null) return null;
    return m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X';
  }
</script>

<svelte:head><title>Comparar · {data.pool.name}</title></svelte:head>

<div style="max-width: 840px; margin: 0 auto;">
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; gap: 4px; margin-bottom: 12px;">← {data.pool.name}</a>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 12px;">⚔️ Comparar</h1>

  {#if !data.betsLocked}
    <div style="padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted);">Disponible cuando se cierren las apuestas.</p>
    </div>
  {:else}
    <!-- Selectors -->
    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 16px;">
      <select bind:value={aSel} onchange={reload} style="flex: 1; min-width: 0; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 8px; color: var(--text);">
        <option value="">Elige…</option>
        {#each data.entries as e}<option value={String(e.id)}>{entryLabel(e)}</option>{/each}
      </select>
      <span style="font-size: 12px; color: var(--text-dim);">vs</span>
      <select bind:value={bSel} onchange={reload} style="flex: 1; min-width: 0; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 8px; color: var(--text);">
        <option value="">Elige…</option>
        {#each data.entries as e}<option value={String(e.id)}>{entryLabel(e)}</option>{/each}
      </select>
    </div>

    {#if !data.a || !data.b}
      <p style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 20px;">Elige dos participantes para comparar sus pronósticos.</p>
    {:else}
      {#if data.attribution}
        {@const at = data.attribution}
        {@const rival = data.b.owner.split(' ')[0]}
        {@const maxCat = Math.max(1, ...at.categories.map((c) => Math.abs(c.delta)))}
        <section style="margin-bottom: 18px; padding: 14px; background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.25); border-radius: 12px;">
          <div style="text-align: center; font-size: 16px; font-weight: 800; color: {at.gap < 0 ? 'var(--red)' : at.gap > 0 ? 'var(--green)' : 'var(--gold)'};">
            {#if at.gap < 0}Vas por detrás de {rival} por {Math.abs(at.gap)} pts
            {:else if at.gap > 0}Le sacas {at.gap} pts a {rival}
            {:else}Empatados con {rival}{/if}
          </div>
          <div style="text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            Tú {at.yourTotal} · {rival} {at.theirTotal}
          </div>

          <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); margin: 14px 0 6px;">DÓNDE SE DECIDIÓ</div>
          {#each at.categories as c}
            {@const w = (Math.abs(c.delta) / maxCat) * 50}
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0;">
              <span style="flex: 1; color: var(--text);">{catLabel(c.category)}</span>
              <span style="width: 110px; display: flex; align-items: center; flex-shrink: 0;">
                <span style="width: 50%; display: flex; justify-content: flex-end;">
                  {#if c.delta < 0}<span style="height: 8px; width: {w}%; background: var(--red); border-radius: 2px;"></span>{/if}
                </span>
                <span style="width: 1px; height: 12px; background: var(--border);"></span>
                <span style="width: 50%;">
                  {#if c.delta > 0}<span style="height: 8px; width: {w}%; background: var(--green); border-radius: 2px; display: block;"></span>{/if}
                </span>
              </span>
              <span style="width: 34px; text-align: right; flex-shrink: 0; font-weight: 700; color: {c.delta < 0 ? 'var(--red)' : c.delta > 0 ? 'var(--green)' : 'var(--text-dim)'};">{c.delta > 0 ? '+' : ''}{c.delta}</span>
            </div>
          {/each}
          <div style="display: flex; font-size: 12px; padding: 6px 0 0; margin-top: 4px; border-top: 1px solid var(--border); font-weight: 800;">
            <span style="flex: 1; color: var(--text-muted);">Total</span>
            <span style="width: 34px; text-align: right; color: {at.gap < 0 ? 'var(--red)' : at.gap > 0 ? 'var(--green)' : 'var(--gold)'};">{at.gap > 0 ? '+' : ''}{at.gap}</span>
          </div>

          {#if at.swings.length > 0}
            <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); margin: 14px 0 6px;">LO QUE MÁS PESÓ</div>
            {#each at.swings as s}
              <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.04);">
                <span style="width: 34px; flex-shrink: 0; font-weight: 800; color: {s.delta < 0 ? 'var(--red)' : 'var(--green)'};">{s.delta > 0 ? '+' : ''}{s.delta}</span>
                <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text);">{s.label}</span>
                <span style="flex-shrink: 0; font-size: 10px; color: var(--text-dim);">tú {s.you} · {rival} {s.them}</span>
              </div>
            {/each}
          {/if}
        </section>
      {/if}

      {#if agreement}
        <div style="text-align: center; margin-bottom: 16px; padding: 10px; background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.22); border-radius: 10px;">
          <div style="font-size: 20px; font-weight: 800; color: var(--gold);">{agreement.same}/{agreement.total}</div>
          <div style="font-size: 12px; color: var(--text-muted);">coincidencias (campeón + ganadores de grupo) · {sharedFinalists}/2 finalistas en común</div>
          {#if groupAgreement && groupAgreement.total > 0}
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">⚽ coinciden en <strong style="color: var(--gold);">{groupAgreement.same}/{groupAgreement.total}</strong> partidos de grupo</div>
          {/if}
        </div>
      {/if}

      {#snippet mark(state: 'correct' | 'wrong' | null)}
        {#if state === 'correct'}<span style="color: var(--green); font-weight: 700;">✓</span>
        {:else if state === 'wrong'}<span style="color: var(--red); font-weight: 700;">✗</span>{/if}
      {/snippet}

      {#snippet row(label: string, av: number | null, bv: number | null, actual: number | null)}
        {@const same = av != null && av === bv}
        {@const aState = actual != null && av != null ? (av === actual ? 'correct' : 'wrong') : null}
        {@const bState = actual != null && bv != null ? (bv === actual ? 'correct' : 'wrong') : null}
        <div style="display: flex; align-items: center; gap: 6px; padding: 7px 8px; background: {same ? 'rgba(0,229,160,0.05)' : 'var(--bg-card)'}; border: 1px solid {same ? 'rgba(0,229,160,0.2)' : 'var(--border)'}; border-radius: 6px;">
          <span style="flex: 1; min-width: 0; font-size: 13px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {same ? 'font-weight: 600;' : ''}">{tName(av)} {@html tFlag(av)}</span>
          <span style="width: 14px; flex-shrink: 0; text-align: center; font-size: 12px;">{@render mark(aState)}</span>
          <span style="font-size: 12px; color: var(--text-dim); width: 46px; text-align: center; flex-shrink: 0; text-transform: uppercase;">{label}</span>
          <span style="width: 14px; flex-shrink: 0; text-align: center; font-size: 12px;">{@render mark(bState)}</span>
          <span style="flex: 1; min-width: 0; font-size: 13px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {same ? 'font-weight: 600;' : ''}">{@html tFlag(bv)} {tName(bv)}</span>
          <span style="width: 12px; flex-shrink: 0; text-align: center; font-size: 13px; color: {same ? 'var(--green)' : 'var(--text-dim)'};">{same ? '=' : '≠'}</span>
        </div>
      {/snippet}

      {#snippet codePill(code: string | null, state: 'correct' | 'wrong' | null)}
        {#if code}
          {@const bg = state === 'correct' ? 'rgba(0,229,160,0.18)' : state === 'wrong' ? 'rgba(255,77,106,0.16)' : (code === 'X' ? 'rgba(255,255,255,0.08)' : 'rgba(201,168,76,0.16)')}
          {@const col = state === 'correct' ? 'var(--green)' : state === 'wrong' ? 'var(--red)' : (code === 'X' ? 'var(--text-muted)' : 'var(--gold)')}
          <span style="display: inline-block; font-size: 12px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: {bg}; color: {col};">{code}{#if state === 'correct'} ✓{:else if state === 'wrong'} ✗{/if}</span>
        {:else}
          <span style="font-size: 12px; color: var(--text-dim);">–</span>
        {/if}
      {/snippet}

      {#snippet matchRow(m: any)}
        {@const ac = data.a?.groupPicks?.[m.id] ?? null}
        {@const bc = data.b?.groupPicks?.[m.id] ?? null}
        {@const same = ac != null && bc != null && ac === bc}
        {@const actual = actualCode(m)}
        {@const aState = actual ? (ac === actual ? 'correct' : 'wrong') : null}
        {@const bState = actual ? (bc === actual ? 'correct' : 'wrong') : null}
        <div style="display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;">
          <span style="width: 34px; flex-shrink: 0; text-align: center;">{@render codePill(ac, aState)}</span>
          <span style="flex: 1; min-width: 0; text-align: center; overflow: hidden;">
            <span style="display: block; font-size: 13px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><span style="font-size: 12px; color: var(--text-dim);">{m.group_name}</span> {@html tFlag(m.home_team_id)} {tName(m.home_team_id)}–{tName(m.away_team_id)} {@html tFlag(m.away_team_id)}</span>
            {#if actual}<span style="font-size: 13px; font-weight: 700; color: var(--gold);">{m.home_score}-{m.away_score}</span>{/if}
          </span>
          <span style="width: 34px; flex-shrink: 0; text-align: center;">{@render codePill(bc, bState)}</span>
          <span style="width: 12px; flex-shrink: 0; text-align: center; font-size: 13px; color: {same ? 'var(--green)' : 'var(--text-dim)'};">{same ? '=' : '≠'}</span>
        </div>
      {/snippet}

      <!-- Names header -->
      <div style="display: flex; gap: 6px; margin-bottom: 8px; padding: 0 8px;">
        <span style="flex: 1; font-size: 13px; font-weight: 700; color: var(--gold); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{data.a.owner}{#if data.a.label} · {data.a.label}{/if}</span>
        <span style="width: 46px;"></span>
        <span style="flex: 1; font-size: 13px; font-weight: 700; color: var(--gold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{data.b.owner}{#if data.b.label} · {data.b.label}{/if}</span>
        <span style="width: 12px;"></span>
      </div>

      <!-- Group-game 1/X/2 comparison, chronological — surfaced first -->
      {#if (data.groupMatches || []).length > 0}
        <div style="margin-bottom: 18px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--gold); margin-bottom: 2px;">⚽ Partidos de grupos · 1 / X / 2</div>
          <p style="font-size: 12px; color: var(--text-dim); margin: 0 0 6px;">columna izq. = {data.a.owner.split(' ')[0]} · der. = {data.b.owner.split(' ')[0]} · <span style="color: var(--green);">✓</span> acertó · = mismo pronóstico</p>
          {#each matchesByDate as [dateLabel, ms]}
            <div style="font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin: 10px 0 4px;">{dateLabel}</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 4px 12px; align-items: start;">
              {#each ms as m}{@render matchRow(m)}{/each}
            </div>
          {/each}
        </div>
      {/if}

      <div style="display: flex; flex-direction: column; gap: 4px;">
        {@render row('Campeón', data.a.champion, data.b.champion, data.actualChampion)}
        {#each groups as g}
          {@render row(`1.º ${g}`, data.a.groupWinners[g] ?? null, data.b.groupWinners[g] ?? null, data.actualGroupWinners?.[g] ?? null)}
        {/each}
      </div>

      <!-- Finalists + tiebreaker -->
      <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
          <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Finalistas · {data.a.owner.split(' ')[0]}</div>
          {#each data.a.finalists as t}<div style="font-size: 13px;">{@html tFlag(t)} {tName(t)}</div>{/each}
          {#if data.a.tiebreaker}<div style="font-size: 12px; color: var(--text-dim); margin-top: 6px;">Final: {data.a.tiebreaker.home}-{data.a.tiebreaker.away}</div>{/if}
        </div>
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
          <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Finalistas · {data.b.owner.split(' ')[0]}</div>
          {#each data.b.finalists as t}<div style="font-size: 13px;">{@html tFlag(t)} {tName(t)}</div>{/each}
          {#if data.b.tiebreaker}<div style="font-size: 12px; color: var(--text-dim); margin-top: 6px;">Final: {data.b.tiebreaker.home}-{data.b.tiebreaker.away}</div>{/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
