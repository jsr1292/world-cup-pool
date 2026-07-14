<script lang="ts">
  import { type GsMatch } from '$lib/group-standings.js';
  import { projectBracket, r32Participants, GROUPS } from '$lib/sim-bracket.js';
  import { groupByPhase, resolveTree, prepEntry, type OddsMatchIn, type Phase } from '$lib/knockout-odds.js';
  import { computeUnifiedProjection, type UnifiedEntry, type ProjCtx } from '$lib/sim-projection.js';
  import { buildForecastSim } from '$lib/sim-forecast.js';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import Icon from '$lib/Icon.svelte';
  let { data, standalone = false, impactVisible = $bindable(false) } = $props();

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
  // Pending group matches (all of data.matches are group-phase), in kickoff order.
  const pendingGroups = $derived((unplayed as any[]).filter((m) => m.group_name));

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

  // A knockout tie is worth showing only while it's still open: both teams known
  // (from real results or your upstream picks) and NOT already played. Finished
  // ties still cascade their winner forward — they just don't take up space here.
  function koPending(phase: string, index: number, slot: { a: number | null; b: number | null }): boolean {
    const m = koByPhase[phase as Phase]?.[index];
    return slot.a != null && slot.b != null && !(m?.finished ?? false);
  }
  const anyKoPending = $derived(
    (['r32', 'r16', 'qf', 'sf'] as const).some((ph) => koTree.rounds[ph].some((s, i) => koPending(ph, i, s)))
    || koPending('final', 0, koTree.rounds.final)
    || koPending('3rd', 0, koTree.rounds.third)
  );

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

  // live total_score per entry id (for delta badges/filters vs current standing)
  const liveByEntryId = $derived.by(() => {
    const m: Record<number, number> = {};
    for (const e of (data.entries as any[]) ?? []) m[e.id] = e.total_score;
    return m;
  });

  // prepped unified entries (bracket picks + this member's group picks/orders)
  const unifiedEntries = $derived.by((): UnifiedEntry[] => {
    const bes = (data.bracketEntries as any[]) ?? [];
    return bes.map((be) => ({
      id: be.id, userId: be.userId, name: be.name, label: be.label,
      live: liveByEntryId[be.id] ?? 0,
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
  const moverCount = $derived(leaderboard.filter((e) => e.move !== 0).length);
  let onlyChanges = $state(false);
  const visibleLeaderboard = $derived(onlyChanges ? leaderboard.filter((e) => e.move !== 0 || e.total !== e.live) : leaderboard);

  const decidedCount = $derived(Object.keys(sim).length + Object.keys(koChoice).length);
  function setPick(mid: number, code: '1' | 'X' | '2') {
    if (sim[mid] === code) { const { [mid]: _d, ...rest } = sim; sim = rest; } else sim = { ...sim, [mid]: code };
  }
  function setKoWinner(phase: string, index: number, teamId: number | null) {
    if (teamId == null) return;
    const k = koKey(phase, index);
    if (koChoice[k] === teamId) { const { [k]: _d, ...rest } = koChoice; koChoice = rest; } else koChoice = { ...koChoice, [k]: teamId };
  }
  function resetAll() { sim = {}; koChoice = {}; forecastId = null; }

  let forecastId = $state<number | null>(null);
  function applyForecast(predId: number | null) {
    forecastId = predId;
    if (predId == null) { sim = {}; koChoice = {}; return; }
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

  // Tell the host (the pool hub) whether the phone impact bar is on screen, so it
  // can lift its floating buttons above it instead of overlapping it.
  $effect(() => { impactVisible = !!(myRow && decidedCount > 0); });

  // "Ver tabla" on the impact bar: scroll the projected standings to your row
  // (falls back to the top of the board if your row is filtered out by "Solo
  // cambios" when you haven't moved).
  function goToMyRow() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('sim-me-row') ?? document.querySelector('.board');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Your own bracket picks, so a pending KO tie can show a gold dot on the team
  // you backed (parallel to the group "tu apuesta" dot from myPick).
  const myKoByPhaseTeam = $derived.by(() => {
    const be = ((data.bracketEntries as any[]) ?? []).find((e) => e.id === myPrimaryId);
    return new Set(((be?.picks ?? []) as any[]).filter((p) => p.teamId != null).map((p) => p.phase + ':' + p.teamId));
  });
  function myKoDot(phase: string, a: number | null, b: number | null): number | null {
    if (a != null && myKoByPhaseTeam.has(phase + ':' + a)) return a;
    if (b != null && myKoByPhaseTeam.has(phase + ':' + b)) return b;
    return null;
  }

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

<div class="sim-page">
  {#if standalone}
    <a href="/pool/{data.pool.id}" class="back-link">← {data.pool.name}</a>
  {/if}
  <h1 class="sim-title"><Icon name="route" size={18} /> Simulador</h1>

  {#if !data.betsLocked}
    <div class="locked">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted); margin: 0;">Disponible cuando se cierren las apuestas.</p>
    </div>
  {:else}
    {#if koMatches.length > 0}
      <div class="subtabs">
        <button class="subtab" class:on={tab === 'sim'} onclick={() => (tab = 'sim')}><Icon name="route" size={13} /> Simulador</button>
        <button class="subtab" class:on={tab === 'odds'} onclick={() => (tab = 'odds')}><Icon name="sparkles" size={13} /> Probabilidades</button>
      </div>
    {/if}

    {#if tab === 'odds'}
      {#if oddsRows.length > 0}
      <!-- Knockout win / podium probabilities (unchanged) -->
      <div style="margin: 0 0 20px; max-width: 620px;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
          <h2 style="font-size: 13px; font-weight: 700; color: var(--text); margin: 0; display: inline-flex; align-items: center; gap: 6px;"><Icon name="sparkles" size={14} /> ¿Quién puede ganar?</h2>
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
      <div class="banner">
        Decide los partidos que faltan —grupos (1/X/2) y eliminatorias— y mira cómo cambiaría la clasificación del bote.
        {#if data.groupPositionPts > 0} Si completas <strong>todos</strong> los partidos de un grupo, también se suman los puntos por la tabla final.{/if}
      </div>

      <!-- one pending knockout tie, porra-style 2-button card -->
      {#snippet koMatchCard(phase: Phase, index: number, slot: any)}
        {@const m = koByPhase[phase]?.[index]}
        {@const fin = m?.finished ?? false}
        {@const w = slot.winner}
        {@const dot = myKoDot(phase, slot.a, slot.b)}
        <div class="sim-match">
          <div class="ko">
            {#each [slot.a, slot.b] as tid}
              <button class="ko-btn" class:on={w != null && w === tid} class:me-pred={dot != null && dot === tid}
                disabled={fin || tid == null} onclick={() => setKoWinner(phase, index, tid)}>
                {#if tid != null}{@html tFlag(tid)} <span class="seg-name">{tName(tid)}</span>{:else}<span class="seg-name" style="color:var(--text-dim);">—</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/snippet}

      <!-- a knockout round: label (spans the grid) + its revealed ties -->
      {#snippet koRound(label: string, phase: Phase, slots: any[])}
        {@const shown = slots.filter((s, i) => koPending(phase, i, s))}
        {#if shown.length > 0}
          <div class="round-label">{label}</div>
          {#each slots as slot, i}
            {#if koPending(phase, i, slot)}{@render koMatchCard(phase, i, slot)}{/if}
          {/each}
        {/if}
      {/snippet}

      <div class="layout">
        <!-- ── Pendientes ─────────────────────────────────────────────────── -->
        <section class="panel">
          <div class="panel-head">
            <h2>Pendientes</h2>
            <div class="panel-actions">
              <span class="sim-count" class:active={decidedCount > 0}>{decidedCount} fijado{decidedCount === 1 ? '' : 's'}</span>
              {#if decidedCount > 0}<button class="pill" onclick={resetAll}>Reiniciar</button>{/if}
            </div>
          </div>

          <select class="forecast-select" onchange={(e) => applyForecast(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
            <option value="">Pronóstico de… (rellena con las apuestas de un participante)</option>
            {#each (data.bracketEntries as any[]) ?? [] as be}
              <option value={be.id} selected={forecastId === be.id}>{be.name}{be.label ? ' · ' + be.label : ''}</option>
            {/each}
          </select>

          {#if myPrimaryId != null}
            <div class="me-legend"><span class="me-dot"></span> Tu apuesta</div>
          {/if}

          {#if pendingGroups.length === 0 && !anyKoPending}
            <div class="empty">No hay nada pendiente por ahora.</div>
          {:else}
            <div class="match-list">
              {#if pendingGroups.length > 0}
                <div class="round-label">Fase de grupos</div>
                {#each pendingGroups as m (m.id)}
                  {@const mp = myPick(m.id)}
                  <div class="sim-match">
                    <div class="sim-meta">
                      <span class="sim-phase">Grupo {m.group_name}</span>
                      <span class="sim-time">{fmtDate(m.kickoff_time)}</span>
                    </div>
                    <div class="seg">
                      <button class="seg-btn left" class:on={sim[m.id] === '1'} class:me-pred={mp === '1'} onclick={() => setPick(m.id, '1')}>
                        {@html tFlag(m.home_team_id)} <span class="seg-name">{tName(m.home_team_id)}</span>
                      </button>
                      <button class="seg-btn mid" class:on={sim[m.id] === 'X'} class:me-pred={mp === 'X'} onclick={() => setPick(m.id, 'X')}>X</button>
                      <button class="seg-btn right" class:on={sim[m.id] === '2'} class:me-pred={mp === '2'} onclick={() => setPick(m.id, '2')}>
                        <span class="seg-name">{tName(m.away_team_id)}</span> {@html tFlag(m.away_team_id)}
                      </button>
                    </div>
                  </div>
                {/each}
              {/if}

              {@render koRound('Dieciseisavos', 'r32', koTree.rounds.r32)}
              {@render koRound('Octavos', 'r16', koTree.rounds.r16)}
              {@render koRound('Cuartos', 'qf', koTree.rounds.qf)}
              {@render koRound('Semifinales', 'sf', koTree.rounds.sf)}
              {@render koRound('Final', 'final', [koTree.rounds.final])}
              {@render koRound('3.er puesto', '3rd', [koTree.rounds.third])}
            </div>
          {/if}
        </section>

        <!-- ── Clasificación proyectada ───────────────────────────────────── -->
        <section class="panel">
          <div class="panel-head">
            <h2>Clasificación proyectada</h2>
            <div class="panel-actions">
              <button class="pill" class:on={onlyChanges} onclick={() => (onlyChanges = !onlyChanges)}><Icon name="filter" size={12} /> Solo cambios</button>
              <span class="muted">{onlyChanges && decidedCount > 0 ? `${visibleLeaderboard.length} con cambios` : `${leaderboard.length} pronóstico${leaderboard.length === 1 ? '' : 's'}`}</span>
            </div>
          </div>

          <div class="board">
            {#if visibleLeaderboard.length === 0}
              <div class="empty">Nadie cambia de puesto con esta simulación.</div>
            {/if}
            {#each visibleLeaderboard as e (e.id)}
              {@const mine = myIds.has(e.id)}
              {@const medal = e.rank === 1 ? 'gold' : e.rank === 2 ? 'silver' : e.rank === 3 ? 'bronze' : ''}
              {@const d = e.total - e.live}
              <div class="row" id={mine ? 'sim-me-row' : undefined} class:me={mine} class:mover={e.move !== 0} class:medal-gold={e.rank === 1}>
                <div class="avatar {medal}">{e.name?.[0]?.toUpperCase() ?? '?'}</div>
                <div class="row-main">
                  <div class="row-name">{e.rank}. {e.name}{#if data.pool.allow_multiple_predictions && e.label}<span class="row-ini"> · {e.label}</span>{:else if e.label}<span class="row-ini"> ({e.label})</span>{/if}</div>
                  <div class="row-delta">
                    {#if e.move > 0}<span class="delta up">▲{e.move}</span>
                    {:else if e.move < 0}<span class="delta down">▼{Math.abs(e.move)}</span>
                    {:else}<span class="delta flat">=</span>{/if}
                    {#if d !== 0}<span class="pts-delta {d > 0 ? 'up' : 'down'}">{d > 0 ? '+' : ''}{d} pts</span>{/if}
                  </div>
                </div>
                <div class="row-right">
                  <div class="row-total">{e.total}</div>
                  <div class="row-pts">pts</div>
                </div>
              </div>
            {/each}
          </div>
        </section>
      </div>

      <!-- Phone: fixed impact bar above the tab bar -->
      {#if myRow && decidedCount > 0}
        <button type="button" class="impact-bar" onclick={goToMyRow} aria-label="Ver tu posición en la tabla proyectada">
          <span class="im-block">
            <span class="im-label">Tú</span>
            <span class="im-rank">{myRow.rank}º</span>
            {#if myRow.move > 0}<span class="im-d up">▲{myRow.move}</span>
            {:else if myRow.move < 0}<span class="im-d down">▼{Math.abs(myRow.move)}</span>{/if}
            {#if myRow.total !== myRow.live}<span class="im-pts {myRow.total > myRow.live ? 'up' : 'down'}">{myRow.total > myRow.live ? '+' : ''}{myRow.total - myRow.live}</span>{/if}
          </span>
          <span class="im-movers">{moverCount} {moverCount === 1 ? 'se mueve' : 'se mueven'}</span>
          <span class="im-cta"><Icon name="table" size={13} /> Ver tabla</span>
        </button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .sim-page { max-width: 1400px; margin: 0 auto; padding: 0 4px; }
  .back-link { font-size: 10px; color: var(--text-muted); display: inline-flex; gap: 4px; margin-bottom: 12px; }
  .sim-title { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 22px; color: var(--gold); margin: 0 0 12px; display: inline-flex; align-items: center; gap: 8px; }

  .locked { margin-top: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center; }

  /* WCP sub-menu (kept) */
  .subtabs { display: flex; gap: 6px; margin: 6px 0 14px; max-width: 460px; }
  .subtab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 8px; border-radius: 7px; cursor: pointer; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); }
  .subtab.on { border-color: var(--gold); background: rgba(201,168,76,0.12); color: var(--gold); }

  .banner { font-size: 11px; color: var(--text-muted); background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.18); border-radius: 8px; padding: 8px 12px; margin-bottom: 18px; line-height: 1.5; }

  /* Web uses the width: Pendientes gets the wider track, the board sits beside it. */
  .layout { display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; gap: 12px; } }

  .panel { min-width: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .panel-head h2 { font-size: 15px; font-weight: 800; color: var(--gold); margin: 0; }
  .panel-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .muted { font-size: 11px; color: var(--text-muted); }
  .sim-count { font-size: 11px; color: var(--text-muted); }
  .sim-count.active { color: var(--gold); font-weight: 600; }
  .empty { text-align: center; padding: 24px 12px; font-size: 12px; color: var(--text-muted); }

  .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 600; color: var(--text-dim); background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 999px; padding: 4px 11px; cursor: pointer; }
  .pill.on { color: var(--gold); background: rgba(201,168,76,0.12); border-color: rgba(201,168,76,0.4); }

  .forecast-select { width: 100%; font-size: 11px; padding: 7px 9px; border-radius: 7px; background: var(--bg-card-solid); border: 1px solid var(--border); color: var(--text); margin-bottom: 10px; cursor: pointer; }

  .me-legend { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-muted); margin-bottom: 10px; }
  .me-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); display: inline-block; }

  /* Multi-column on web; single column on phones. Round labels span the grid. */
  .match-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
  @media (max-width: 520px) { .match-list { grid-template-columns: 1fr; } }
  .round-label { grid-column: 1 / -1; font-size: 9px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em; margin: 8px 0 2px; }
  .round-label:first-child { margin-top: 0; }

  .sim-match { background: var(--bg-card-solid); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
  .sim-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .sim-phase { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
  .sim-time { font-size: 10px; color: var(--text-dim); }

  /* 3-way segmented control [home | X | away] */
  .seg { display: grid; grid-template-columns: 1fr auto 1fr; gap: 4px; }
  .seg-btn, .ko-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    font-size: 12px; color: var(--text-muted);
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 8px; cursor: pointer; min-width: 0;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }
  .seg-btn.left { justify-content: flex-end; }
  .seg-btn.right { justify-content: flex-start; }
  .seg-btn.mid { font-weight: 700; padding-left: 12px; padding-right: 12px; }
  .seg-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seg-btn :global(img), .ko-btn :global(img) { flex-shrink: 0; }
  .seg-btn:not(:disabled):hover, .ko-btn:not(:disabled):hover { border-color: var(--border-hover); color: var(--text); }
  .seg-btn.on, .ko-btn.on {
    color: var(--gold); font-weight: 700;
    background: rgba(201,168,76,0.12); border-color: rgba(201,168,76,0.5);
    box-shadow: inset 0 0 0 1px rgba(201,168,76,0.3);
  }
  .ko-btn:disabled { cursor: default; }
  .ko { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  /* the member's own pick: a gold dot in the option's corner */
  .seg-btn.me-pred, .ko-btn.me-pred { position: relative; }
  .seg-btn.me-pred::after, .ko-btn.me-pred::after {
    content: ''; position: absolute; top: 4px; right: 4px; width: 6px; height: 6px;
    border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 2px var(--bg-card-solid);
  }

  /* ── projected board ─────────────────────────────────────────────────── */
  .board { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 10px; background: var(--bg-card-solid); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; }
  .row.medal-gold { border-color: rgba(201,168,76,0.2); box-shadow: 0 0 16px rgba(201,168,76,0.08); }
  .row.mover { border-color: rgba(201,168,76,0.32); }
  .row.me { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold), 0 0 14px rgba(201,168,76,0.22); }
  .avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; background: rgba(255,255,255,0.06); color: var(--text-dim); }
  .avatar.gold { background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e; }
  .avatar.silver { background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e; }
  .avatar.bronze { background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e; }
  .row-main { flex: 1; min-width: 0; }
  .row-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-ini { color: var(--text-muted); font-weight: 400; }
  .row-delta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .delta { font-size: 11px; font-weight: 700; }
  .delta.up { color: var(--green); } .delta.down { color: var(--red); } .delta.flat { color: var(--text-dim); }
  .pts-delta { font-size: 10px; font-weight: 600; }
  .pts-delta.up { color: var(--green); } .pts-delta.down { color: var(--red); }
  .row-right { text-align: right; flex-shrink: 0; }
  .row-total { font-size: 17px; font-weight: 800; color: var(--gold); line-height: 1; font-variant-numeric: tabular-nums; }
  .row-pts { font-size: 9px; color: var(--text-muted); }

  /* ── phone impact bar (fixed, mobile only) ───────────────────────────── */
  .impact-bar { display: none; }
  @media (max-width: 900px) {
    .impact-bar {
      display: flex; align-items: center; gap: 10px;
      /* Sit ABOVE the bottom nav (~56px + safe area) so it doesn't cover it. */
      position: fixed; left: 10px; right: 10px; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); z-index: 95;
      padding: 9px 14px; background: var(--bg-card-solid);
      border: 1px solid rgba(201,168,76,0.4); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      cursor: pointer; text-align: left; font: inherit; color: inherit; width: auto;
      /* Slide up when it appears (you've decided a pick, so a projection exists). */
      animation: impact-in 0.25s ease;
      /* Glide down into the space the nav vacates when it auto-hides on scroll. */
      transition: bottom 0.25s ease;
    }
    /* When the nav auto-hides on scroll-down, drop the bar to the bottom edge. */
    :global(html.nav-collapsed) .impact-bar {
      bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }
  }
  @keyframes impact-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .impact-bar { animation: none; } }
  .im-block { display: inline-flex; align-items: baseline; gap: 5px; }
  .im-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
  .im-rank { font-size: 16px; font-weight: 800; color: var(--gold); }
  .im-d { font-size: 11px; font-weight: 700; }
  .im-d.up, .im-pts.up { color: var(--green); }
  .im-d.down, .im-pts.down { color: var(--red); }
  .im-pts { font-size: 11px; font-weight: 700; }
  .im-movers { flex: 1; text-align: center; font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
  .im-cta { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: 11px; font-weight: 700; color: #1a1a2e; background: linear-gradient(135deg, #e8c96a, #c9a84c); border-radius: 999px; padding: 4px 11px; }
</style>
