<script lang="ts">
  import { type GsMatch } from '$lib/group-standings.js';
  import { projectBracket, r32Participants, GROUPS } from '$lib/sim-bracket.js';
  import { groupByPhase, resolveTree, prepEntry, type OddsMatchIn, type Phase } from '$lib/knockout-odds.js';
  import { computeUnifiedProjection, type UnifiedEntry, type ProjCtx } from '$lib/sim-projection.js';
  import { buildForecastSim } from '$lib/sim-forecast.js';
  import { flagEmoji, shortName } from '$lib/teams.js';
  let { data, standalone = false } = $props();

  // Two tabs now: the fused simulator, and the (unchanged) odds tab.
  let tab = $state<'sim' | 'odds'>('sim');

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  function tName(id: number) { const n = teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function tFlag(id: number) { return flagEmoji(teams[id]?.flag_code || ''); }

  const isFinished = (m: any) => m.status === 'finished' && m.home_score != null;
  const played = $derived((data.matches as any[]).filter(isFinished));
  const unplayed = $derived((data.matches as any[]).filter((m) => !isFinished(m)));

  // group sim (matchId → 1/X/2) and knockout choices (phase:index → teamId)
  let sim = $state<Record<number, '1' | 'X' | '2'>>({});
  let koChoice = $state<Record<string, number>>({});
  const koKey = (phase: string, index: number) => phase + ':' + index;

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

  // ── Unified group + knockout projection ─────────────────────────────────────
  // combined real+sim GsMatch per group (for projectBracket)
  const gmsByGroup = $derived.by(() => {
    const out: Record<string, GsMatch[]> = {};
    const played: Record<string, number> = {};
    for (const g of GROUPS) {
      const real = realByGroup[g] || [];
      out[g] = [...real];
      played[g] = real.length;
      for (const m of (unplayedByGroup[g] || [])) {
        if (sim[m.id]) { const [hs, as] = canon(sim[m.id]); out[g].push({ homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, homeScore: hs, awayScore: as }); }
      }
    }
    return { out, played };
  });
  const proj = $derived(projectBracket(gmsByGroup.out, gmsByGroup.played));
  const r32parts = $derived(r32Participants(proj));

  // knockout tree cascaded from projected R32 participants + user choices
  const koMatches = $derived((data.koMatches as OddsMatchIn[]) ?? []);
  const koByPhase = $derived(groupByPhase(koMatches));
  const koRules = $derived((data.knockoutRules as Record<string, number>) ?? {});
  // choose honours a pick only while its team is still one of the two participants
  // (so choices auto-clear when an upstream pick changes who reaches this match).
  const koTree = $derived(resolveTree(koByPhase, (m, a, b) => {
    const w = koChoice[koKey(m.phase, m.index)];
    return w === a || w === b ? w : null;
  }, r32parts));

  // groups the sim FULLY completes → their resulting order (for group_position pts)
  const simOrderByGroup = $derived.by(() => {
    const out: Record<string, number[]> = {};
    if (data.groupPositionPts > 0) {
      for (const g of GROUPS) {
        const pg = proj.perGroup[g];
        if (pg.complete && pg.order && (unplayedByGroup[g] || []).some((m) => sim[m.id])) out[g] = pg.order;
      }
    }
    return out;
  });

  // prepped unified entries (bracket picks + this member's group picks/orders)
  const unifiedEntries = $derived.by((): UnifiedEntry[] => {
    const bes = (data.bracketEntries as any[]) ?? [];
    return bes.map((be) => ({
      id: be.id, userId: be.userId, name: be.name, label: be.label,
      prepped: prepEntry(be),
      groupPicks: (data.picks[be.id] as Record<number, '1' | 'X' | '2'>) ?? {},
      groupOrders: (data.orders[be.id] as Record<string, number[]>) ?? {},
    }));
  });

  const projCtx = $derived<ProjCtx>({
    sim, unplayedByGroup, simOrderByGroup,
    matchOutcomePts: data.matchOutcomePts, groupPositionPts: data.groupPositionPts,
    baseRankById,
  });
  const leaderboard = $derived(computeUnifiedProjection(unifiedEntries, koTree, koRules, projCtx));
  let onlyChanges = $state(false);
  const visibleLeaderboard = $derived(onlyChanges ? leaderboard.filter((e) => e.move !== 0 || e.total !== e.base) : leaderboard);

  const decidedCount = $derived(Object.keys(sim).length + Object.keys(koChoice).length);
  function setPick(mid: number, code: '1' | 'X' | '2') {
    if (sim[mid] === code) { const { [mid]: _d, ...rest } = sim; sim = rest; } else sim = { ...sim, [mid]: code };
  }
  function setKoWinner(phase: string, index: number, teamId: number | null) {
    if (teamId == null) return;
    const k = koKey(phase, index);
    if (koChoice[k] === teamId) { const { [k]: _d, ...rest } = koChoice; koChoice = rest; } else koChoice = { ...koChoice, [k]: teamId };
  }
  function resetAll() { sim = {}; koChoice = {}; }

  let forecastId = $state<number | null>(null);
  function applyForecast(predId: number | null) {
    forecastId = predId;
    if (predId == null) { resetAll(); return; }
    const be = ((data.bracketEntries as any[]) ?? []).find((e) => e.id === predId);
    if (!be) return;
    // 1) group stage from their 1/X/2
    const unplayedGroupMatchIds = unplayed.filter((m: any) => m.group_name).map((m: any) => m.id);
    sim = buildForecastSim({ groupPicks: data.picks[predId] ?? {}, bracketPicks: be.picks }, { unplayedGroupMatchIds }).sim;
    // 2) KO stage: iterate to a fixpoint, filling each newly-revealed tie with the
    //    member's picked team for that phase (bounded passes = KO depth).
    const wantByPhaseTeam = new Set(be.picks.filter((p: any) => p.teamId != null).map((p: any) => p.phase + ':' + p.teamId));
    let next: Record<string, number> = {};
    for (let pass = 0; pass < 6; pass++) {
      const tree = resolveTree(koByPhase, (m, a, b) => {
        const w = next[koKey(m.phase, m.index)];
        return w === a || w === b ? w : null;
      }, r32parts);
      const rounds: [Phase, any[]][] = [
        ['r32', r32parts.map((p, i) => ({ a: p.a, b: p.b, index: i }))],
        ['r16', tree.rounds.r16], ['qf', tree.rounds.qf], ['sf', tree.rounds.sf],
        ['final', [tree.rounds.final]], ['3rd', [tree.rounds.third]],
      ];
      const before = JSON.stringify(next);
      for (const [phase, slots] of rounds) {
        slots.forEach((s: any, i: number) => {
          const k = koKey(phase, i);
          if (next[k] != null) return;
          for (const cand of [s.a, s.b]) {
            if (cand != null && wantByPhaseTeam.has(phase + ':' + cand)) { next[k] = cand; break; }
          }
        });
      }
      if (JSON.stringify(next) === before) break;
    }
    koChoice = next;
  }

  const myIds = $derived(new Set((data.entries as any[]).filter((e) => e.user_id === data.userId).map((e) => e.id)));
  const myPrimaryId = $derived((data.entries as any[]).find((e) => e.user_id === data.userId)?.id ?? null);
  function myPick(mid: number): string | null { return myPrimaryId != null ? (data.picks[myPrimaryId]?.[mid] ?? null) : null; }
  const myRow = $derived(myPrimaryId != null ? leaderboard.find((e) => e.id === myPrimaryId) : null);

  // ── Knockout win/podium probabilities (computed server-side) ────────────────
  const oddsRows = $derived((data.odds as any[]) ?? []);
  const oddsMeta = $derived(data.oddsMeta as any);
  function fmtPct(p: number): string {
    if (p <= 0) return '0%';
    if (p >= 100) return '100%';
    if (p < 1) return '<1%';
    if (p > 99) return '99%';
    return Math.round(p) + '%';
  }
</script>

<div style="max-width: 900px; margin: 0 auto;">
  {#if standalone}
    <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; gap: 4px; margin-bottom: 12px;">← {data.pool.name}</a>
  {/if}
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 4px;">🎲 Simulador</h1>

  {#if !data.betsLocked}
    <div style="margin-top: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted);">Disponible cuando se cierren las apuestas.</p>
    </div>
  {:else}
    {#if koMatches.length > 0}
      <div style="display:flex; gap:6px; margin:6px 0 14px;">
        <button onclick={() => (tab = 'sim')} style="flex:1; font-size:10px; font-weight:600; padding:7px; border-radius:7px; cursor:pointer; border:1px solid {tab==='sim'?'var(--gold)':'var(--border)'}; background:{tab==='sim'?'rgba(201,168,76,0.12)':'var(--bg-card)'}; color:{tab==='sim'?'var(--gold)':'var(--text-muted)'};">🎯 Simulador</button>
        <button onclick={() => (tab = 'odds')} style="flex:1; font-size:10px; font-weight:600; padding:7px; border-radius:7px; cursor:pointer; border:1px solid {tab==='odds'?'var(--gold)':'var(--border)'}; background:{tab==='odds'?'rgba(201,168,76,0.12)':'var(--bg-card)'}; color:{tab==='odds'?'var(--gold)':'var(--text-muted)'};">🔮 Probabilidades</button>
      </div>
    {/if}

    {#if tab === 'odds'}
      {#if oddsRows.length > 0}
      <!-- Knockout win / podium probabilities -->
      <div style="margin: 0 0 20px;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
          <h2 style="font-size: 13px; font-weight: 700; color: var(--text); margin: 0;">🔮 ¿Quién puede ganar?</h2>
          {#if oddsMeta}<span style="font-size: 8px; color: var(--text-dim);">{oddsMeta.remaining} partido{oddsMeta.remaining === 1 ? '' : 's'} · {oddsMeta.scenarios.toLocaleString('es-ES')} escenarios{#if !oddsMeta.exact} (muestra){/if}</span>{/if}
        </div>
        <p style="font-size: 9px; color: var(--text-muted); margin: 0 0 10px; line-height: 1.5;">
          Probabilidad de acabar <strong>1.º</strong> o <strong>entre los 3 primeros</strong>, contando todos los resultados aún posibles de lo que queda (cada partido 50/50; los equipos ya eliminados quedan descartados). Tiene en cuenta los pronósticos de todos.
        </p>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          {#each oddsRows as e (e.id)}
            {@const mine = myIds.has(e.id)}
            <div style="display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 6px; background: {mine ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)'}; border: 1px solid {mine ? 'var(--gold)' : 'var(--border)'};">
              <span style="flex: 1; min-width: 0;">
                <span style="display: block; font-size: 11px; font-weight: {mine ? '700' : '500'}; color: {mine ? 'var(--gold)' : 'var(--text)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.name}{#if data.pool.allow_multiple_predictions && e.label} · {e.label}{:else if e.label} ({e.label}){/if}{#if e.clinchedWin}<span title="Campeón matemático"> 👑</span>{:else if e.clinchedPodium}<span title="Podio asegurado" style="color: var(--green);"> ✅</span>{:else if !e.alive}<span title="Sin opciones de podio" style="color: var(--text-dim);"> ❌</span>{/if}</span>
                {#if e.bestRank}<span style="display: block; font-size: 8px; color: var(--text-dim);">puede acabar {e.bestRank === e.worstRank ? e.bestRank + '.º' : e.bestRank + '.º–' + e.worstRank + '.º'}</span>{/if}
              </span>
              <div style="width: 60px; flex-shrink: 0; text-align: right;">
                <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em;">ganar</div>
                <div style="font-size: 13px; font-weight: 700; color: {e.winPct > 0 ? 'var(--gold)' : 'var(--text-dim)'};">{fmtPct(e.winPct)}</div>
              </div>
              <div style="width: 60px; flex-shrink: 0; text-align: right;">
                <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em;">podio</div>
                <div style="font-size: 13px; font-weight: 700; color: {e.podiumPct > 0 ? 'var(--green)' : 'var(--text-dim)'};">{fmtPct(e.podiumPct)}</div>
              </div>
            </div>
          {/each}
        </div>
      </div>
      {:else}
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 16px;">Todavía no hay probabilidades que mostrar.</p>
      {/if}
    {:else}
      <p style="font-size: 10px; color: var(--text-muted); margin: 4px 0 12px; line-height: 1.5;">
        Decide los partidos que faltan —grupos (1/X/2) y eliminatorias— y mira cómo cambiaría la clasificación del bote.
        {#if data.groupPositionPts > 0}Si completas <strong>todos</strong> los partidos de un grupo, también se suman los puntos por la tabla final.{/if}
      </p>

      {#snippet koMatch(phase: Phase, index: number, slot: any)}
        {@const m = koByPhase[phase]?.[index]}
        {@const fin = m?.finished ?? false}
        {@const w = slot.winner}
        <div style="display: flex; align-items: stretch; gap: 4px; margin-bottom: 4px;">
          {#each [slot.a, slot.b] as tid}
            {@const isW = w != null && w === tid}
            <button onclick={() => setKoWinner(phase, index, tid)} disabled={fin || tid == null}
              style="flex: 1; min-width: 0; text-align: left; font-size: 10px; padding: 6px 8px; border-radius: 6px; cursor: {fin || tid == null ? 'default' : 'pointer'}; border: 1px solid {isW ? 'var(--gold)' : 'var(--border)'}; background: {isW ? 'rgba(201,168,76,0.16)' : 'var(--bg-surface)'}; color: {tid == null ? 'var(--text-dim)' : isW ? 'var(--gold)' : 'var(--text)'}; font-weight: {isW ? '700' : '400'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {#if tid != null}{@html tFlag(tid)} {tName(tid)}{#if isW} ✓{/if}{:else}—{/if}
            </button>
          {/each}
        </div>
      {/snippet}

      {#snippet koRound(label: string, phase: Phase, slots: any[])}
        {@const live = slots.filter((s) => s.a != null || s.b != null)}
        {#if live.length > 0}
          <div style="font-size:9px; color:var(--gold); text-transform:uppercase; letter-spacing:0.08em; margin:12px 0 5px;">{label}</div>
          {#each slots as slot, i}
            {#if slot.a != null || slot.b != null}{@render koMatch(phase, i, slot)}{/if}
          {/each}
        {/if}
      {/snippet}

      <div class="sim-grid">
        <!-- LEFT: Pendientes -->
        <div class="sim-col">
          <select onchange={(e) => applyForecast(e.currentTarget.value ? Number(e.currentTarget.value) : null)} style="width:100%; font-size:11px; padding:6px 8px; border-radius:6px; background:var(--bg-card); border:1px solid var(--border); color:var(--text); margin-bottom:10px;">
            <option value="">Pronóstico de… (elige un participante)</option>
            {#each (data.bracketEntries as any[]) ?? [] as be}
              <option value={be.id} selected={forecastId === be.id}>{be.name}{be.label ? ' · ' + be.label : ''}</option>
            {/each}
          </select>

          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <h2 style="font-size:12px; font-weight:700; color:var(--text); margin:0;">Pendientes</h2>
            <span style="font-size:9px; color:var(--text-dim);">{decidedCount} decidido{decidedCount===1?'':'s'}{#if decidedCount>0} · <button onclick={resetAll} style="background:none; border:none; color:var(--gold); font-size:9px; cursor:pointer; padding:0; text-decoration:underline;">limpiar</button>{/if}</span>
          </div>

          <!-- (a) pending GROUP matches by date (1/X/2 controls) -->
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

          <!-- (b) KO rounds, revealed progressively as participants become known -->
          {@render koRound('Dieciseisavos', 'r32', koTree.rounds.r32)}
          {@render koRound('Octavos', 'r16', koTree.rounds.r16)}
          {@render koRound('Cuartos', 'qf', koTree.rounds.qf)}
          {@render koRound('Semifinales', 'sf', koTree.rounds.sf)}
          {@render koRound('Final', 'final', [koTree.rounds.final])}
          {@render koRound('3.er puesto', '3rd', [koTree.rounds.third])}
        </div>

        <!-- RIGHT: projected leaderboard -->
        <div class="sim-col">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <h2 style="font-size:12px; font-weight:700; color:var(--text); margin:0;">Clasificación proyectada</h2>
            <button onclick={() => (onlyChanges = !onlyChanges)} style="background:none; border:1px solid {onlyChanges?'var(--gold)':'var(--border)'}; color:{onlyChanges?'var(--gold)':'var(--text-muted)'}; font-size:9px; border-radius:5px; padding:2px 6px; cursor:pointer;">Solo cambios</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:3px;">
            {#each visibleLeaderboard as e (e.id)}
              {@const mine = myIds.has(e.id)}
              <div style="display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:6px; background:{mine?'rgba(201,168,76,0.1)':'var(--bg-card)'}; border:1px solid {mine?'var(--gold)':'var(--border)'};">
                <span style="width:18px; font-size:11px; font-weight:700; color:{e.rank===1?'var(--gold)':'var(--text-muted)'};">{e.rank}</span>
                {#if e.move!==0}<span style="font-size:9px; font-weight:700; color:{e.move>0?'var(--green)':'var(--red)'};">{e.move>0?'▲':'▼'}{Math.abs(e.move)}</span>{:else}<span style="width:12px;"></span>{/if}
                <span style="flex:1; min-width:0; font-size:11px; font-weight:{mine?'700':'500'}; color:{mine?'var(--gold)':'var(--text)'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{e.name}{#if data.pool.allow_multiple_predictions && e.label} · {e.label}{:else if e.label} ({e.label}){/if}</span>
                <span style="flex-shrink:0; text-align:right;">
                  <span style="font-size:13px; font-weight:700; color:var(--gold);">{e.total}</span>
                  {#if e.total!==e.base}<span style="font-size:9px; color:{e.total>e.base?'var(--green)':'var(--red)'}; margin-left:3px;">{e.total>e.base?'+':''}{e.total-e.base}</span>{/if}
                </span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      {#if myRow && decidedCount > 0}
        <div class="impact-bar">
          <span>Vas <strong style="color:var(--gold);">{myRow.rank}.º</strong></span>
          <span style="color:{myRow.move>0?'var(--green)':myRow.move<0?'var(--red)':'var(--text-muted)'};">{myRow.move>0?`▲ subes ${myRow.move}`:myRow.move<0?`▼ bajas ${Math.abs(myRow.move)}`:'sin cambios'}</span>
          <span style="color:var(--gold); font-weight:700;">{myRow.total}{#if myRow.total!==myRow.base} ({myRow.total>myRow.base?'+':''}{myRow.total-myRow.base}){/if}</span>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .sim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  .sim-col { min-width: 0; }
  .impact-bar { display: none; }
  @media (max-width: 720px) {
    .impact-bar { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; gap: 12px; justify-content: space-around; align-items: center; padding: 8px 12px; font-size: 11px; background: var(--bg-card); border-top: 1px solid var(--gold); }
  }
  @media (max-width: 720px) {
    .sim-grid { grid-template-columns: 1fr; gap: 10px; }
  }
</style>
