<script lang="ts">
  import { rankGroup, type GsMatch } from '$lib/group-standings.js';
  import { flagEmoji, shortName } from '$lib/teams.js';
  let { data } = $props();

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  function tName(id: number) { const n = teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function tFlag(id: number) { return flagEmoji(teams[id]?.flag_code || ''); }

  const isFinished = (m: any) => m.status === 'finished' && m.home_score != null;
  const played = $derived((data.matches as any[]).filter(isFinished));
  const unplayed = $derived((data.matches as any[]).filter((m) => !isFinished(m)));

  // sim: matchId -> '1' | 'X' | '2' (unset = undecided)
  let sim = $state<Record<number, '1' | 'X' | '2'>>({});
  const decidedCount = $derived(Object.keys(sim).length);
  function setPick(mid: number, code: '1' | 'X' | '2') {
    if (sim[mid] === code) { const { [mid]: _drop, ...rest } = sim; sim = rest; }
    else sim = { ...sim, [mid]: code };
  }
  function reset() { sim = {}; }

  function fmtDate(ts: string | null) {
    if (!ts) return 'Fecha por confirmar';
    return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const unplayedByDate = $derived.by((): [string, any[]][] => {
    const out: [string, any[]][] = [];
    let cur: [string, any[]] | null = null;
    for (const m of unplayed) {
      const label = fmtDate(m.kickoff_time);
      if (!cur || cur[0] !== label) { cur = [label, []]; out.push(cur); }
      cur[1].push(m);
    }
    return out;
  });

  const realByGroup = $derived.by(() => {
    const out: Record<string, GsMatch[]> = {};
    for (const m of played) {
      if (!m.group_name) continue;
      (out[m.group_name] ??= []).push({ homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, homeScore: m.home_score, awayScore: m.away_score });
    }
    return out;
  });
  const unplayedByGroup = $derived.by(() => {
    const out: Record<string, any[]> = {};
    for (const m of unplayed) { if (m.group_name) (out[m.group_name] ??= []).push(m); }
    return out;
  });
  // Canonical scoreline for a 1/X/2 outcome (same convention the app stores picks
  // in), so a simulated group can be ranked with rankGroup.
  const canon = (c: string): [number, number] => (c === '1' ? [1, 0] : c === '2' ? [0, 1] : [0, 0]);

  // Current standings (dense rank by real total) for movement arrows.
  const baseRankById = $derived.by(() => {
    const sorted = [...(data.entries as any[])].sort((a, b) => b.total_score - a.total_score);
    const rank: Record<number, number> = {};
    let r = 0, prev: number | null = null;
    sorted.forEach((e) => { if (prev === null || e.total_score < prev) { r++; prev = e.total_score; } rank[e.id] = r; });
    return rank;
  });

  const projection = $derived.by(() => {
    const mo = data.matchOutcomePts, gpp = data.groupPositionPts;
    // Groups that the simulation fully completes → their projected final order.
    const simOrderByGroup: Record<string, number[]> = {};
    if (gpp > 0) {
      for (const g of Object.keys(unplayedByGroup)) {
        const ups = unplayedByGroup[g];
        if (!ups.every((m) => sim[m.id])) continue; // not all remaining decided
        const gms: GsMatch[] = [...(realByGroup[g] || [])];
        for (const m of ups) { const [hs, as] = canon(sim[m.id]); gms.push({ homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, homeScore: hs, awayScore: as }); }
        if (gms.length === 6) simOrderByGroup[g] = rankGroup(gms);
      }
    }
    const rows = (data.entries as any[]).map((e) => {
      let proj = e.total_score;
      for (const m of unplayed) {
        const code = sim[m.id]; if (!code) continue;
        if (data.picks[e.id]?.[m.id] === code) proj += mo;
      }
      if (gpp > 0) {
        for (const g of Object.keys(simOrderByGroup)) {
          const order = simOrderByGroup[g], pred = data.orders[e.id]?.[g];
          if (!pred) continue;
          for (let i = 0; i < 4; i++) { if (pred[i] && order[i] === pred[i]) proj += gpp; }
        }
      }
      return { id: e.id, user_id: e.user_id, name: e.display_name, label: e.label, base: e.total_score, proj };
    }).sort((a, b) => b.proj - a.proj || b.base - a.base);
    // dense rank by projected score
    let r = 0, prev: number | null = null;
    return rows.map((row) => {
      if (prev === null || row.proj < prev) { r++; prev = row.proj; }
      return { ...row, rank: r, move: baseRankById[row.id] - r };
    });
  });

  const myIds = $derived(new Set((data.entries as any[]).filter((e) => e.user_id === data.userId).map((e) => e.id)));
  // The viewer's own pick per match, as a reminder of what they bet.
  const myPrimaryId = $derived((data.entries as any[]).find((e) => e.user_id === data.userId)?.id ?? null);
  function myPick(mid: number): string | null { return myPrimaryId != null ? (data.picks[myPrimaryId]?.[mid] ?? null) : null; }
</script>

<svelte:head><title>Simulador · {data.pool.name}</title></svelte:head>

<div style="max-width: 560px; margin: 0 auto; padding: 16px;">
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; gap: 4px; margin-bottom: 12px;">← {data.pool.name}</a>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 4px;">🎲 Simulador</h1>

  {#if !data.betsLocked}
    <div style="margin-top: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted);">Disponible cuando se cierren las apuestas.</p>
    </div>
  {:else if unplayed.length === 0}
    <p style="font-size: 12px; color: var(--text-muted); margin-top: 16px;">No quedan partidos de grupos por jugar.</p>
  {:else}
    <p style="font-size: 10px; color: var(--text-muted); margin: 4px 0 14px; line-height: 1.5;">
      Decide los partidos de grupos que faltan (1/X/2) y mira cómo cambiaría la clasificación.
      {#if data.groupPositionPts > 0}Si completas <strong>todos</strong> los partidos de un grupo, también se suman los puntos por la tabla final.{/if}
    </p>

    <!-- Projected standings -->
    <div style="position: sticky; top: 0; z-index: 5; background: var(--bg-base); padding: 6px 0 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <h2 style="font-size: 12px; font-weight: 700; color: var(--text); margin: 0;">Clasificación proyectada</h2>
        <span style="font-size: 9px; color: var(--text-dim);">{decidedCount} decidido{decidedCount === 1 ? '' : 's'}{#if decidedCount > 0} · <button onclick={reset} style="background: none; border: none; color: var(--gold); font-size: 9px; cursor: pointer; padding: 0; text-decoration: underline;">limpiar</button>{/if}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 3px; max-height: 38vh; overflow-y: auto;">
        {#each projection as e (e.id)}
          {@const mine = myIds.has(e.id)}
          <div style="display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 6px; background: {mine ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)'}; border: 1px solid {mine ? 'var(--gold)' : 'var(--border)'};">
            <span style="width: 18px; font-size: 11px; font-weight: 700; color: {e.rank === 1 ? 'var(--gold)' : 'var(--text-muted)'};">{e.rank}</span>
            {#if e.move !== 0}<span style="font-size: 9px; font-weight: 700; color: {e.move > 0 ? 'var(--green)' : 'var(--red)'};">{e.move > 0 ? '▲' : '▼'}{Math.abs(e.move)}</span>{:else}<span style="width: 12px;"></span>{/if}
            <span style="flex: 1; min-width: 0; font-size: 11px; font-weight: {mine ? '700' : '500'}; color: {mine ? 'var(--gold)' : 'var(--text)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.name}{#if data.pool.allow_multiple_predictions && e.label} · {e.label}{:else if e.label} ({e.label}){/if}</span>
            <span style="flex-shrink: 0; text-align: right;">
              <span style="font-size: 13px; font-weight: 700; color: var(--gold);">{e.proj}</span>
              {#if e.proj !== e.base}<span style="font-size: 9px; color: var(--green); margin-left: 3px;">+{e.proj - e.base}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Match controls -->
    <div style="margin-top: 14px;">
      {#each unplayedByDate as [dateLabel, ms]}
        <div style="font-size: 9px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 5px;">{dateLabel}</div>
        <div style="display: flex; flex-direction: column; gap: 5px;">
          {#each ms as m}
            {@const mp = myPick(m.id)}
            <div style="background: var(--bg-surface); border: 1px solid {sim[m.id] ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 7px; padding: 7px 9px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 8px; color: var(--text-dim); width: 12px; flex-shrink: 0;">{m.group_name}</span>
                <span style="flex: 1; min-width: 0; text-align: right; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {sim[m.id] === '1' ? 'font-weight: 700; color: var(--text);' : 'color: var(--text-muted);'}">{tName(m.home_team_id)} {@html tFlag(m.home_team_id)}</span>
                <div style="display: flex; gap: 3px; flex-shrink: 0;">
                  {#each ['1', 'X', '2'] as code}
                    <button onclick={() => setPick(m.id, code as '1' | 'X' | '2')} style="width: 24px; height: 24px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid {sim[m.id] === code ? 'var(--gold)' : mp === code ? 'rgba(201,168,76,0.45)' : 'var(--border)'}; background: {sim[m.id] === code ? 'var(--gold)' : 'var(--bg-card)'}; color: {sim[m.id] === code ? '#1a1a2e' : 'var(--text-muted)'};">{code}</button>
                  {/each}
                </div>
                <span style="flex: 1; min-width: 0; text-align: left; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {sim[m.id] === '2' ? 'font-weight: 700; color: var(--text);' : 'color: var(--text-muted);'}">{@html tFlag(m.away_team_id)} {tName(m.away_team_id)}</span>
              </div>
              {#if mp}
                <div style="margin-top: 6px; padding-top: 5px; border-top: 1px dashed var(--border); text-align: center; font-size: 8px; color: var(--text-dim);">
                  tu apuesta: <strong style="color: {sim[m.id] === mp ? 'var(--green)' : 'var(--gold)'};">{mp}</strong>{#if sim[m.id] === mp} · +{data.matchOutcomePts} pt{/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    <p style="font-size: 9px; color: var(--text-dim); margin-top: 16px; line-height: 1.5;">
      Proyección sobre los puntos de grupos (1/X/2{#if data.groupPositionPts > 0} y tabla final{/if}). Los puntos de eliminatorias no se simulan aquí.
    </p>
  {/if}
</div>
