<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import { showToast } from '$lib/toast';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import { rankGroup } from '$lib/group-standings.js';

  let { data } = $props();

  const GROUP_NAMES = $derived(
    data.presentGroups?.length > 0
      ? data.presentGroups
      : ['A','B','C','D','E','F','G','H','I','J','K','L']
  );
  const totalGroups = $derived(GROUP_NAMES.length);
  const pool = $derived(data.pool);
  const allowMultiple = $derived(!!data.pool.allow_multiple_predictions);

  // Progress tracking — a group is "done" once all 6 of its scorelines are in.
  const groupsCompleted = $derived.by(() => GROUP_NAMES.filter(g => groupComplete(g)).length);
  const progressPct = $derived(Math.round((groupsCompleted / totalGroups) * 100));

  // Deadline countdown
  let countdown = $state('');
  // 8a: Client-side lock — true if server locked at page load OR if countdown reached zero
  const effectivelyLocked = $derived(data.isLocked || countdown === 'Cerrado');
  $effect(() => {
    const dl = pool.deadline_group;
    if (!dl) return;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const diff = new Date(dl).getTime() - Date.now();
      if (diff <= 0) { countdown = 'Cerrado'; return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      countdown = `${h}h ${m}m`;
    };
    update();
    const iv = setInterval(update, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  });

  // ─── Group standings (derived from predicted scorelines) ───────────────
  // The group stage is predicted as 6 scorelines per group; the final table is
  // DERIVED from them with the shared FIFA ranking (the same rankGroup the server
  // re-runs on save and the scoring engine uses for the REAL table). The player
  // never drags a table — they type scores and watch the standings sort.

  const MEDAL = { 0: '#c9a84c', 1: '#a0a0a0', 2: '#b87333' };

  function groupFixtures(group) {
    return data.groupMatchesByGroup?.[group] || [];
  }

  // Kickoff formatting in the viewer's local timezone. ISO/UTC in, Spanish out.
  const _dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const _timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
  function dayKey(iso) { return iso ? new Date(iso).toLocaleDateString('es-ES') : ''; }
  function dayLabel(iso) { return iso ? _dayFmt.format(new Date(iso)) : ''; }
  function timeLabel(iso) { return iso ? _timeFmt.format(new Date(iso)) : ''; }

  // True once every one of a group's 6 fixtures has a complete scoreline entered.
  function groupComplete(group) {
    const fx = groupFixtures(group);
    if (fx.length === 0) return false;
    return fx.every(m => {
      const s = matchScores[m.id];
      return s && s.home != null && s.away != null;
    });
  }

  // Returns { rows: [{ team, ranked }], complete } — always the 4 group teams:
  // those with enough entered scorelines to be ranked come first (in derived
  // order); any not-yet-rankable teams follow (provisional, id order).
  function derivedStandings(group) {
    const gs = [];
    for (const m of groupFixtures(group)) {
      const s = matchScores[m.id];
      if (s && s.home != null && s.away != null) {
        gs.push({ homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, homeScore: s.home, awayScore: s.away });
      }
    }
    const order = rankGroup(gs);
    const teamMap = {};
    for (const t of (data.teamsByGroup?.[group] || [])) teamMap[Number(t.id)] = t;
    const rankedIds = new Set(order.map(Number));
    const rows = [];
    for (const id of order) {
      const team = teamMap[Number(id)];
      if (team) rows.push({ team, ranked: true });
    }
    for (const t of (data.teamsByGroup?.[group] || [])) {
      if (!rankedIds.has(Number(t.id))) rows.push({ team: t, ranked: false });
    }
    return { rows, complete: groupComplete(group) };
  }

  // ─── Entry management ─────────────────────────────────────────────────

  async function switchEntry(label) {
    const url = new URL($page.url);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    await goto(url.pathname + url.search, { invalidateAll: true });
  }

  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');
  let showCreateEntry = $state(false);

  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true; createMsg = '';
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        newEntryLabel = '';
        await goto(`/pool/${pool.id}/predict?entry=${encodeURIComponent(d.label)}`, { invalidateAll: true });
      } else { createMsg = d.error || 'Error'; }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }

  // ─── Knockout Match Scores ─────────────────────────────────────────────

  // Initialize match scores from existing predictions
  // Match scores — re-derive when data changes (entry switch)
  const matchScoresInit = $derived.by(() => {
    const init = {};
    for (const [matchId, score] of Object.entries(data.existingMatchPreds || {})) {
      init[Number(matchId)] = { home: score.home_score, away: score.away_score };
    }
    return init;
  });
  let matchScores = $state({});
  // §4.1 — Mirror the _activeEdits guard used for `selections`. Only overwrite
  // entries the user is not currently editing so a soft navigation
  // invalidate doesn't blow away unsaved typing.
  const _activeMatchEdits = new Set();
  $effect(() => {
    // Depend on matchScoresInit only. Reading `matchScores` here (via the
    // spread) AND writing it below previously made this effect self-triggering
    // → "effect_update_depth_exceeded" (infinite loop, blank page). Do the
    // read+merge+write inside untrack so only matchScoresInit is a dependency.
    const fresh = JSON.parse(JSON.stringify(matchScoresInit));
    untrack(() => {
      const next = { ...matchScores };
      for (const [matchIdStr, score] of Object.entries(fresh)) {
        const matchId = Number(matchIdStr);
        if (!_activeMatchEdits.has(matchId)) {
          next[matchId] = score;
        }
      }
      matchScores = next;
    });
  });

  // Cleanup timers on component destroy
  $effect(() => {
    return () => {
      if (matchSaveTimer) clearTimeout(matchSaveTimer);
    };
  });

  let matchSaving = $state(false);
  let matchSaved = $state(false);
  let matchSaveTimer = null;

  function autoSaveMatchScores() {
    if (matchSaveTimer) clearTimeout(matchSaveTimer);
    matchSaveTimer = setTimeout(saveMatchScores, 600);
  }

  async function saveMatchScores() {
    if (!data.selectedId) return;
    matchSaving = true; matchSaved = false;
    try {
      const scores = {};
      for (const [matchIdStr, score] of Object.entries(matchScores)) {
        // DATA-LOSS FIX (same class as the group bug): only send COMPLETE
        // scores. The endpoint DELETEs a prediction when either side is null,
        // so sending a half-typed/empty score (or a stale empty entry from
        // another device) would wipe an already-saved prediction. Incomplete
        // scores simply aren't transmitted.
        if (score.home == null || score.away == null) continue;
        scores[matchIdStr] = { home_score: score.home, away_score: score.away };
      }
      if (Object.keys(scores).length === 0) { matchSaving = false; return; }
      const res = await fetch('/api/predictions/match-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, scores }),
      });
      if (res.ok) {
        matchSaved = true;
        _activeMatchEdits.clear();
        setTimeout(() => matchSaved = false, 2000);
      } else {
        // §4.3 — Surface the save failure to the user instead of swallowing it.
        const body = await res.json().catch(() => ({}));
        showToast('⚠️ ' + (body.error || 'Error al guardar marcadores'));
      }
    } catch (e) {
      console.error(e);
      showToast('⚠️ Error al guardar marcadores — inténtalo de nuevo');
    }
    finally { matchSaving = false; }
  }

  function setMatchScore(matchId, side, value) {
    const score = matchScores[matchId] || { home: null, away: null };
    if (side === 'home') score.home = value;
    else score.away = value;
    matchScores[matchId] = score;
    _activeMatchEdits.add(Number(matchId));
    autoSaveMatchScores();
  }

  const PHASE_LABELS = {
    r32: 'Dieciseisavos',
    r16: 'Octavos',
    qf: 'Cuartos',
    sf: 'Semifinales',
    '3rd': '3º y 4º puesto',
    final: 'Final',
  };
  const PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  function getMatchScore(matchId, side) {
    const s = matchScores[matchId];
    if (!s) return '';
    return side === 'home' ? (s.home ?? '') : (s.away ?? '');
  }

</script>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Volver a la quiniela
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Pronósticos de Fase de Grupos</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Predice el marcador de los 6 partidos de cada grupo. La clasificación se calcula sola.
    </p>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
      Resultado (1/X/2): <strong style="color: var(--gold);">+1</strong> · + diferencia de goles: <strong style="color: var(--gold);">+1</strong> · marcador exacto: <strong style="color: var(--gold);">+3</strong> · cada puesto acertado de la tabla: <strong style="color: var(--gold);">+2</strong>
    </p>

    <!-- Progress bar -->
    <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">
      <div style="flex: 1; max-width: 280px; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden;">
        <div style="width: {progressPct}%; height: 100%; background: linear-gradient(90deg, var(--gold), #e8c96a); border-radius: 3px; transition: width 0.4s ease;"></div>
      </div>
      <span style="font-size: 10px; color: {groupsCompleted === totalGroups ? 'var(--green)' : 'var(--text-dim)'}; font-weight: 500; white-space: nowrap;">
        {groupsCompleted === totalGroups ? '✅' : ''} {groupsCompleted}/{totalGroups} grupos
      </span>
    </div>

    {#if countdown && countdown !== 'Cerrado' && !effectivelyLocked}
      <div style="margin-top: 8px; padding: 8px 12px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 6px; font-size: 10px; color: var(--gold);">
        ⏰ Cierre en: {countdown}
      </div>
    {/if}
    {#if effectivelyLocked}
      <div style="margin-top: 8px; padding: 8px 12px; background: rgba(255,77,106,0.1); border: 1px solid var(--red); border-radius: 6px; font-size: 10px; color: var(--red);">
        ⚠️ Los pronósticos están bloqueados — la fecha límite ha pasado.
      </div>
    {/if}
  </div>

  <!-- Entry Selector -->
  {#if data.entries.length > 0 || allowMultiple}
    <div style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Entrada:</label>
      {#if data.entries.length > 1}
        <select value={data.selectedLabel} onchange={(e) => switchEntry(e.target.value)}
          style="font-size: 11px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text);">
          {#each data.entries as entry}
            <option value={entry.label}>{entry.label} {entry.total_score > 0 ? `(${entry.total_score} pts)` : ''}</option>
          {/each}
        </select>
      {:else if data.entries.length === 1}
        <span style="font-size: 12px; font-weight: 600; color: var(--gold); padding: 6px 10px; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.3); border-radius: 6px;">
          {data.entries[0].label} {data.entries[0].total_score > 0 ? `(${data.entries[0].total_score} pts)` : ''}
        </span>
      {/if}
      {#if allowMultiple}
        <button onclick={() => { showCreateEntry = true; newEntryLabel = ''; }}
          style="font-size: 9px; padding: 6px 12px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;">
          + Nueva entrada
        </button>
      {/if}
    </div>
  {/if}

  <!-- Create entry inline form -->
  {#if allowMultiple && showCreateEntry}
    <div style="margin-bottom: 20px; padding: 14px; background: var(--bg-card); border: 1px solid var(--gold); border-radius: 8px;">
      <div style="font-size: 11px; color: var(--gold); margin-bottom: 10px; font-weight: 600;">Nueva entrada</div>
      <div style="display: flex; gap: 8px; align-items: flex-end;">
        <div style="flex: 1;">
          <label style="display: block; font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px;">Nombre de la entrada</label>
          <input bind:value={newEntryLabel} placeholder="Ej: Apuesta conservadora..."
            style="width: 100%; font-size: 12px; padding: 8px 10px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text);"
            onkeydown={(e) => { if (e.key === 'Enter') createEntry(); }} />
        </div>
        <button onclick={createEntry} disabled={creating || !newEntryLabel.trim()} class="btn-primary" style="font-size: 9px; padding: 8px 16px; white-space: nowrap;">
          {creating ? 'Creando...' : 'Crear'}
        </button>
        <button onclick={() => { showCreateEntry = false; newEntryLabel = ''; createMsg = ''; }}
          style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
      </div>
      {#if createMsg}<div style="margin-top: 8px; font-size: 10px; color: var(--red);">{createMsg}</div>{/if}
    </div>
  {/if}

  <!-- Group prediction cards: predict 6 scorelines, table derives itself -->
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const fixtures = groupFixtures(group)}
      {@const entered = fixtures.filter(m => { const s = matchScores[m.id]; return s && s.home != null && s.away != null; }).length}
      {@const complete = entered === 6 && fixtures.length === 6}
      {@const allLocked = fixtures.length > 0 && fixtures.every(m => m.locked)}
      {@const ds = derivedStandings(group)}

      <div class="group-card" style="background: var(--bg-card); border: 1px solid {complete ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 10px; padding: 14px; {complete ? 'box-shadow: 0 0 12px rgba(201,168,76,0.08);' : ''}">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">{group}</div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>
          {#if allLocked}
            <span style="margin-left: auto; font-size: 9px; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 10px;">🔒 Cerrado</span>
          {:else if complete}
            <span style="margin-left: auto; font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 2px 8px; border-radius: 10px;">✓ Completo</span>
          {:else}
            <span style="margin-left: auto; font-size: 9px; color: var(--text-dim); background: rgba(255,255,255,0.04); padding: 2px 8px; border-radius: 10px;">{entered}/6</span>
          {/if}
        </div>

        <!-- Fixtures: enter each scoreline, in chronological order, by day -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          {#each fixtures as match, i}
            {@const mLocked = match.locked || effectivelyLocked}
            {@const dayChanged = i === 0 || dayKey(match.kickoff) !== dayKey(fixtures[i - 1]?.kickoff)}
            {#if match.kickoff && dayChanged}
              <div style="font-size: 9px; color: var(--gold); letter-spacing: 0.04em; text-transform: capitalize; margin: 6px 0 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(201,168,76,0.12);">📅 {dayLabel(match.kickoff)}</div>
            {/if}
            <div style="display: flex; align-items: center; gap: 6px; {mLocked ? 'opacity: 0.6;' : ''}">
              {#if match.kickoff}
                <span style="font-size: 9px; color: var(--text-dim); width: 34px; flex-shrink: 0; text-align: left;">{#if match.locked}🔒{:else}{timeLabel(match.kickoff)}{/if}</span>
              {/if}
              <div style="flex: 1; display: flex; align-items: center; gap: 4px; justify-content: flex-end; min-width: 0;">
                <span style="font-size: 11px; font-weight: 500; color: var(--text); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(match.home_name)}</span>
                <span style="font-size: 15px; flex-shrink: 0;">{@html flagEmoji(match.home_flag)}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <input
                  type="number" min="0" max="20" inputmode="numeric" placeholder="-"
                  value={getMatchScore(match.id, 'home')}
                  oninput={(e) => setMatchScore(match.id, 'home', e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                  disabled={mLocked}
                  style="width: 34px; text-align: center; font-size: 15px; font-weight: 700; padding: 5px 2px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--gold);"
                />
                <span style="font-size: 12px; color: var(--text-muted);">—</span>
                <input
                  type="number" min="0" max="20" inputmode="numeric" placeholder="-"
                  value={getMatchScore(match.id, 'away')}
                  oninput={(e) => setMatchScore(match.id, 'away', e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                  disabled={mLocked}
                  style="width: 34px; text-align: center; font-size: 15px; font-weight: 700; padding: 5px 2px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--gold);"
                />
              </div>
              <div style="flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0;">
                <span style="font-size: 15px; flex-shrink: 0;">{@html flagEmoji(match.away_flag)}</span>
                <span style="font-size: 11px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(match.away_name)}</span>
              </div>
            </div>
          {/each}
        </div>

        <!-- Derived standings -->
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 8px; color: var(--text-dim); letter-spacing: 0.1em; text-transform: uppercase;">Clasificación</span>
            {#if !complete}
              <span style="font-size: 8px; color: var(--text-dim); font-style: italic;">provisional</span>
            {/if}
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px; {complete ? '' : 'opacity: 0.7;'}">
            {#each ds.rows as row, i}
              {@const pos = i + 1}
              {@const accent = pos <= 2 ? 'var(--green)' : pos === 3 ? '#b87333' : 'var(--text-dim)'}
              <div style="display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 5px; background: {pos <= 2 ? 'rgba(0,229,160,0.06)' : pos === 3 ? 'rgba(184,115,51,0.06)' : 'transparent'}; {pos === 2 ? 'border-bottom: 1px solid rgba(0,229,160,0.25); border-radius: 5px 5px 0 0;' : ''}">
                <div style="width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; color: {accent}; border: 1px solid {accent}; flex-shrink: 0;">{pos}</div>
                <span style="font-size: 11px; font-weight: {pos <= 2 ? '600' : '400'}; color: {row.ranked ? 'var(--text)' : 'var(--text-dim)'}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><span style="font-size: 14px; margin-right: 4px;">{@html flagEmoji(row.team.flag_code)}</span>{shortName(row.team.name)}</span>
                {#if pos <= 2}<span style="font-size: 8px; color: var(--green);">clasifica</span>{:else if pos === 3}<span style="font-size: 8px; color: #b87333;">3.º</span>{/if}
              </div>
            {/each}
          </div>
          <p style="font-size: 8px; color: var(--text-dim); margin-top: 6px; line-height: 1.4;">
            1.º y 2.º pasan directos · los mejores 3.º entran como repesca. Empates: criterios FIFA (dif. de goles, goles, etc.).
          </p>
        </div>
      </div>
    {/each}
  </div>

  <!-- Group scores auto-save indicator -->
  {#if !effectivelyLocked}
    <div style="margin-top: 12px; display: flex; gap: 12px; align-items: center;">
      {#if matchSaving}
        <span style="font-size: 10px; color: var(--text-muted);">Guardando...</span>
      {:else if matchSaved}
        <span style="font-size: 10px; color: var(--green);">✓ Guardado</span>
      {:else}
        <span style="font-size: 10px; color: var(--text-dim);">Guardado automático</span>
      {/if}
    </div>
  {/if}

  <!-- Knockout Match Scores Section -->
  {#if Object.keys(data.knockoutByPhase || {}).length > 0}
    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border);">
      <div style="margin-bottom: 16px;">
        <h2 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold); margin-bottom: 4px;">⚽ Resultados de Eliminatorias</h2>
        <p style="font-size: 10px; color: var(--text-muted);">Predice el marcador exacto de cada partido eliminado.</p>
        <p style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          Resultado (1/X/2): <strong style="color: var(--gold);">+1</strong> · + diferencia de goles: <strong style="color: var(--gold);">+1</strong> · marcador exacto: <strong style="color: var(--gold);">+3</strong>
        </p>
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 6px; line-height: 1.5;">
          💡 El marcador se juzga al final del tiempo reglamentario o la prórroga. Si quieres predecir que el partido acaba en empate, pon el mismo marcador (p. ej. 1-1): los penaltis deciden quién pasa, pero no cuentan para el marcador. Quién avanza se elige aparte en el <strong>cuadro eliminatorio</strong>.
        </p>
      </div>

      {#each PHASE_ORDER as phase}
        {@const phaseMatches = data.knockoutByPhase?.[phase] || []}
        {#if phaseMatches.length > 0}
          <div style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <h3 style="font-size: 12px; font-weight: 600; color: var(--text); margin: 0;">{PHASE_LABELS[phase] || phase}</h3>
              <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 8px; border-radius: 8px;">{phaseMatches.length} partidos</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
              {#each phaseMatches as match}
                <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; gap: 10px;">
                  <!-- Home team -->
                  <div style="flex: 1; display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
                    <span style="font-size: 13px; font-weight: 500; color: var(--text); text-align: right;">{shortName(match.home_name)}</span>
                    <span style="font-size: 18px;">{@html flagEmoji(match.home_flag)}</span>
                  </div>

                  <!-- Score inputs -->
                  <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      inputmode="numeric"
                      placeholder="-"
                      value={getMatchScore(match.id, 'home')}
                      oninput={(e) => setMatchScore(match.id, 'home', e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                      disabled={effectivelyLocked}
                      style="width: 40px; text-align: center; font-size: 16px; font-weight: 700; padding: 6px 4px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--gold);"
                    />
                    <span style="font-size: 14px; color: var(--text-muted);">—</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      inputmode="numeric"
                      placeholder="-"
                      value={getMatchScore(match.id, 'away')}
                      oninput={(e) => setMatchScore(match.id, 'away', e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                      disabled={effectivelyLocked}
                      style="width: 40px; text-align: center; font-size: 16px; font-weight: 700; padding: 6px 4px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--gold);"
                    />
                  </div>

                  <!-- Away team -->
                  <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 18px;">{@html flagEmoji(match.away_flag)}</span>
                    <span style="font-size: 13px; font-weight: 500; color: var(--text);">{shortName(match.away_name)}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      <!-- Match scores auto-save indicator -->
      {#if !effectivelyLocked}
        <div style="margin-top: 8px; display: flex; gap: 12px; align-items: center;">
          {#if matchSaving}
            <span style="font-size: 10px; color: var(--text-muted);">Guardando marcadores...</span>
          {:else if matchSaved}
            <span style="font-size: 10px; color: var(--green);">✓ Marcadores guardados</span>
          {:else}
            <span style="font-size: 10px; color: var(--text-dim);">Guardado automático</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Bracket CTA -->
  {#if !effectivelyLocked && data.selectedId}
    <div style="margin-top: 20px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; text-align: center;">
      <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
        {#if groupsCompleted >= totalGroups}
          ¡Grupos completados! Ahora predice las eliminatorias
        {:else}
          Predice también el cuadro eliminatorio ({groupsCompleted}/{totalGroups} grupos listos)
        {/if}
      </p>
      <a href="/pool/{pool.id}/bracket" class="btn-primary" style="font-size: 11px; padding: 10px 24px; display: inline-block; text-decoration: none;">⚔️ Cuadro Eliminatorio →</a>
    </div>
  {/if}
</div>

<style>
  .group-card { min-width: 0; }
</style>
