<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import { showToast } from '$lib/toast';
  import { haptic } from '$lib/haptic';
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
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      countdown = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
    };
    update();
    const iv = setInterval(update, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  });

  // Human-readable deadline date/times, in the VIEWER's local zone. Set in an
  // effect (client-only) so SSR and hydration agree (server tz would differ).
  let knockoutDeadlineText = $state('');
  let groupDeadlineText = $state('');
  function fmtDeadline(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  $effect(() => {
    knockoutDeadlineText = fmtDeadline(pool.deadline_knockout);
    groupDeadlineText = fmtDeadline(pool.deadline_group);
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
  const _dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' });
  const _timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
  function dayKey(iso) { return iso ? new Date(iso).toLocaleDateString('es-ES') : ''; }
  function dateShort(iso) { return iso ? _dateFmt.format(new Date(iso)) : ''; }
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
    // Apply the player's manual order (if any) as the tiebreak among teams level
    // on points — same call the server uses, so preview and saved bracket agree.
    const order = rankGroup(gs, groupOrders[group]);
    const pts = {};
    for (const g of gs) {
      pts[g.homeTeamId] = pts[g.homeTeamId] || 0;
      pts[g.awayTeamId] = pts[g.awayTeamId] || 0;
      if (g.homeScore > g.awayScore) pts[g.homeTeamId] += 3;
      else if (g.homeScore < g.awayScore) pts[g.awayTeamId] += 3;
      else { pts[g.homeTeamId] += 1; pts[g.awayTeamId] += 1; }
    }
    const teamMap = {};
    for (const t of (data.teamsByGroup?.[group] || [])) teamMap[Number(t.id)] = t;
    const rankedIds = new Set(order.map(Number));
    const rows = [];
    for (const id of order) {
      const team = teamMap[Number(id)];
      if (team) rows.push({ team, ranked: true, points: pts[Number(id)] ?? 0 });
    }
    for (const t of (data.teamsByGroup?.[group] || [])) {
      if (!rankedIds.has(Number(t.id))) rows.push({ team: t, ranked: false, points: 0 });
    }
    return { rows, complete: groupComplete(group) };
  }

  // ─── Entry management ─────────────────────────────────────────────────

  // Flush any pending group-score autosave to the CURRENT (old) entry before we
  // navigate — otherwise the debounced save could fire after the switch and write
  // the previous entry's picks onto the newly-selected one.
  async function flushMatchScores() {
    if (matchSaveTimer) { clearTimeout(matchSaveTimer); matchSaveTimer = null; await saveMatchScores(); }
  }

  async function switchEntry(entryId) {
    await flushMatchScores();
    const url = new URL($page.url);
    if (entryId) url.searchParams.set('entry', String(entryId));
    else url.searchParams.delete('entry');
    await goto(url.pathname + url.search, { invalidateAll: true });
  }

  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');
  let showCreateEntry = $state(false);
  let copyFromId = $state(''); // optional source entry to seed a NEW entry from

  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true; createMsg = '';
    await flushMatchScores(); // save the current entry's edits before switching away
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        // Optionally seed the brand-new entry from an existing one.
        if (copyFromId) {
          const cr = await fetch('/api/predictions/entry/copy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: Number(copyFromId), target_id: d.id }),
          });
          if (!cr.ok) { createMsg = (await cr.json()).error || 'No se pudo copiar'; creating = false; return; }
        }
        newEntryLabel = ''; copyFromId = '';
        await goto(`/pool/${pool.id}/predict?entry=${d.id}`, { invalidateAll: true });
      } else { createMsg = d.error || 'Error'; }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }

  // Copy another entry's picks ONTO the currently-selected entry (overwrites it).
  let copyOntoSourceId = $state('');
  let copying = $state(false);
  let copyMsg = $state('');
  async function copyEntryOnto() {
    if (!copyOntoSourceId || !data.selectedId) return;
    const src = data.entries.find(e => e.id === Number(copyOntoSourceId));
    const tgtLabel = data.selectedLabel || 'Entrada principal';
    if (!confirm(`Esto reemplazará TODOS los pronósticos de «${tgtLabel}» con una copia de «${src?.label}». ¿Continuar?`)) return;
    copying = true; copyMsg = '';
    await flushMatchScores(); // persist any pending edits on the current entry first (they'll be overwritten, but keeps state consistent)
    try {
      const r = await fetch('/api/predictions/entry/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(copyOntoSourceId), target_id: data.selectedId }),
      });
      const d = await r.json();
      if (r.ok) {
        copyOntoSourceId = '';
        // The selected entry id doesn't change, so force the state effects to take
        // their RESET branch on the post-invalidate re-run (otherwise they'd merge
        // stale local edits over the freshly-copied data).
        _lastMatchEntryId = null; _lastGroupEntryId = null;
        _activeMatchEdits.clear(); _activeGroupEdits.clear();
        await goto($page.url.pathname + $page.url.search, { invalidateAll: true });
      } else { copyMsg = d.error || 'No se pudo copiar'; }
    } catch { copyMsg = 'Error de conexión'; }
    copying = false;
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
  let _lastMatchEntryId = null;
  $effect(() => {
    // Depend on matchScoresInit only. Reading `matchScores` here (via the
    // spread) AND writing it below previously made this effect self-triggering
    // → "effect_update_depth_exceeded" (infinite loop, blank page). Do the
    // read+merge+write inside untrack so only matchScoresInit is a dependency.
    const fresh = JSON.parse(JSON.stringify(matchScoresInit));
    untrack(() => {
      if (data.selectedId !== _lastMatchEntryId) {
        // Switched to a DIFFERENT entry — fully replace (don't merge), and drop
        // the previous entry's in-progress edits. Merging would bleed the old
        // entry's picks into the new one.
        _lastMatchEntryId = data.selectedId;
        _activeMatchEdits.clear();
        matchScores = fresh;
        return;
      }
      // Same entry, soft invalidate: keep the user's unsaved typing.
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

  // Manual group-table order (the player's tiebreak among teams level on points).
  // Seeded from the server; updated optimistically on each ▲▼ move.
  const groupOrdersInit = $derived.by(() => ({ ...(data.groupOrders || {}) }));
  let groupOrders = $state({});
  const _activeGroupEdits = new Set();
  let _lastGroupEntryId = null;
  let _reorderHintShown = false;

  // Effective scoring (defaults + pool overrides) for the intro copy.
  const outcomePts = $derived(Number(data.scoring?.match_outcome ?? 1));
  const groupPosPts = $derived(Number(data.scoring?.group_position ?? 0));
  $effect(() => {
    const fresh = JSON.parse(JSON.stringify(groupOrdersInit));
    untrack(() => {
      if (data.selectedId !== _lastGroupEntryId) {
        // Entry switch — replace, don't merge (would bleed the old entry's order).
        _lastGroupEntryId = data.selectedId;
        _activeGroupEdits.clear();
        groupOrders = fresh;
        return;
      }
      const next = { ...groupOrders };
      for (const [g, ord] of Object.entries(fresh)) {
        if (!_activeGroupEdits.has(g)) next[g] = ord;
      }
      groupOrders = next;
    });
  });

  // Move a team up/down among teammates LEVEL ON POINTS (the only legal reorder).
  async function moveTeam(group, index, dir) {
    if (effectivelyLocked) return;
    const rows = derivedStandings(group).rows;
    const j = index + dir;
    if (j < 0 || j >= rows.length) return;
    if (!rows[index].ranked || !rows[j].ranked) return;
    if (rows[index].points !== rows[j].points) return; // points are the hard constraint
    const prevOrder = groupOrders[group];
    const order = rows.map((r) => Number(r.team.id));
    [order[index], order[j]] = [order[j], order[index]];
    _activeGroupEdits.add(group);
    groupOrders = { ...groupOrders, [group]: order };
    haptic(8);
    // The bracket seeds its matchups from this order, so a reorder can shift an
    // already-filled cuadro. Nudge once so the user knows to review it.
    if (!_reorderHintShown) {
      _reorderHintShown = true;
      showToast('ℹ️ Orden actualizado. Si ya rellenaste el cuadro, revísalo: las eliminatorias se reordenan con el grupo.');
    }
    await saveGroupOrder(group, order, prevOrder);
  }

  async function saveGroupOrder(group, order, prevOrder) {
    if (!data.selectedId) return;
    const revert = () => {
      // Undo the optimistic update so the preview matches what's actually saved.
      groupOrders = { ...groupOrders, [group]: prevOrder };
      _activeGroupEdits.delete(group);
    };
    try {
      const res = await fetch('/api/predictions/group-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, group_name: group, order }),
      });
      if (res.ok) {
        _activeGroupEdits.delete(group);
      } else {
        const b = await res.json().catch(() => ({}));
        revert();
        showToast('⚠️ ' + (b.error || 'No se pudo guardar el orden'));
      }
    } catch {
      revert();
      showToast('⚠️ Error al guardar el orden');
    }
  }

  // On component destroy, FLUSH a pending debounced save instead of dropping it
  // — otherwise a 1/X/2 pick made <600ms before navigating to another page is
  // silently lost. Fire-and-forget: the SPA stays alive across client-side
  // navigation, so the in-flight fetch completes against the entry being left.
  $effect(() => {
    return () => {
      if (matchSaveTimer) { clearTimeout(matchSaveTimer); matchSaveTimer = null; saveMatchScores(); }
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

  // Group matches are predicted as 1/X/2 (home win / draw / away win). We encode
  // the pick as a canonical scoreline in the existing match-scores machinery —
  // 1 → 1-0, X → 0-0, 2 → 0-1 — so the same save + standings-derivation flow is
  // reused; only the input (these buttons) and the points (outcome-only) change.
  function getOutcome(matchId) {
    const s = matchScores[matchId];
    if (!s || s.home == null || s.away == null) return null;
    if (s.home > s.away) return '1';
    if (s.home < s.away) return '2';
    return 'X';
  }
  function setOutcome(matchId, outcome) {
    const map = { '1': { home: 1, away: 0 }, 'X': { home: 0, away: 0 }, '2': { home: 0, away: 1 } };
    matchScores[matchId] = { ...map[outcome] };
    _activeMatchEdits.add(Number(matchId));
    autoSaveMatchScores();
  }

</script>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Volver a la quiniela
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Pronósticos de Fase de Grupos</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Pronostica el resultado de cada partido — <strong>1</strong> (gana local) · <strong>X</strong> (empate) · <strong>2</strong> (gana visitante). La clasificación se calcula sola con tus aciertos.
    </p>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
      Cada resultado acertado: <strong style="color: var(--gold);">+{outcomePts}</strong> punto{outcomePts === 1 ? '' : 's'}.{#if groupPosPts > 0} Además, <strong style="color: var(--gold);">+{groupPosPts}</strong> por cada puesto acertado de la tabla final de cada grupo.{/if}
    </p>

    <!-- Two-part reminder: people finish the groups and forget the knockout,
         which locks at the same deadline. Make it unmissable. -->
    {#if !effectivelyLocked && data.selectedId}
      <div style="margin-top: 12px; padding: 11px 13px; background: rgba(201,168,76,0.12); border: 1px solid var(--gold); border-radius: 8px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--gold); margin-bottom: 4px;">⚠️ Esta quiniela tiene 2 partes — no te quedes solo con los grupos</div>
        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.55; margin-bottom: 8px;">
          <strong style="color: var(--text);">1·</strong> Fase de grupos (esta página) &nbsp;·&nbsp; <strong style="color: var(--text);">2·</strong> Cuadro eliminatorio: quién avanza + el marcador de la final. {#if knockoutDeadlineText}El cuadro se bloquea el <strong style="color: var(--gold);">{knockoutDeadlineText}</strong> — rellénalo también a tiempo.{:else}Rellénalo también antes de la fecha límite.{/if}
        </div>
        <a href={`/pool/${pool.id}/bracket${data.selectedId ? `?entry=${data.selectedId}` : ''}`} class="btn-primary" style="font-size: 10px; padding: 7px 14px; display: inline-block; text-decoration: none;">⚔️ Ir al cuadro eliminatorio →</a>
      </div>
    {/if}

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
        ⏰ Cierre en: {countdown}{#if groupDeadlineText} · {groupDeadlineText}{/if}
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
        <select value={String(data.selectedId)} onchange={(e) => switchEntry(e.target.value)}
          style="font-size: 11px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text);">
          {#each data.entries as entry}
            <option value={String(entry.id)}>{entry.label} {entry.total_score > 0 ? `(${entry.total_score} pts)` : ''}</option>
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
        <button onclick={() => { showCreateEntry = false; newEntryLabel = ''; copyFromId = ''; createMsg = ''; }}
          style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
      </div>
      {#if data.entries.length > 0}
        <div style="margin-top: 10px;">
          <label style="display: block; font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px;">Empezar desde</label>
          <select bind:value={copyFromId}
            style="width: 100%; font-size: 12px; padding: 8px 10px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text);">
            <option value="">En blanco</option>
            {#each data.entries as entry}
              <option value={String(entry.id)}>Copia de: {entry.label}</option>
            {/each}
          </select>
          {#if copyFromId}<div style="margin-top: 4px; font-size: 9px; color: var(--text-dim);">Se copiarán todos los pronósticos; luego puedes hacer cambios.</div>{/if}
        </div>
      {/if}
      {#if createMsg}<div style="margin-top: 8px; font-size: 10px; color: var(--red);">{createMsg}</div>{/if}
    </div>
  {/if}

  <!-- Copy another entry ONTO the current one (overwrite) -->
  {#if data.entries.length > 1 && !effectivelyLocked && data.selectedId}
    <div style="margin-bottom: 20px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Copiar a esta entrada desde:</label>
      <select bind:value={copyOntoSourceId}
        style="font-size: 11px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text);">
        <option value="">Elige una entrada…</option>
        {#each data.entries.filter(e => e.id !== data.selectedId) as entry}
          <option value={String(entry.id)}>{entry.label}</option>
        {/each}
      </select>
      <button onclick={copyEntryOnto} disabled={copying || !copyOntoSourceId}
        style="font-size: 9px; padding: 6px 12px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer; opacity: {copying || !copyOntoSourceId ? 0.5 : 1};">
        {copying ? 'Copiando…' : '⧉ Copiar aquí'}
      </button>
      {#if copyMsg}<span style="font-size: 10px; color: var(--red);">{copyMsg}</span>{/if}
    </div>
  {/if}

  <!-- Legend (once, instead of repeating in every card) -->
  <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 10px; line-height: 1.4;">
    <span style="color: var(--green);">●</span> 1.º y 2.º clasifican · <span style="color: #b87333;">●</span> mejores 3.º a la repesca · si dos equipos quedan <strong>empatados a puntos</strong>, usa las flechas <span style="color: var(--gold);">▲▼</span> para ordenarlos a tu gusto (eso decide el cuadro).
  </p>

  <!-- Group prediction cards: predict 6 scorelines, table derives itself -->
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 10px;">
    {#each GROUP_NAMES as group}
      {@const fixtures = groupFixtures(group)}
      {@const entered = fixtures.filter(m => { const s = matchScores[m.id]; return s && s.home != null && s.away != null; }).length}
      {@const complete = entered === 6 && fixtures.length === 6}
      {@const allLocked = fixtures.length > 0 && fixtures.every(m => m.locked)}
      {@const ds = derivedStandings(group)}
      {@const hasTie = complete && !effectivelyLocked && ds.rows.some((r, i) => i > 0 && r.ranked && ds.rows[i - 1].ranked && ds.rows[i - 1].points === r.points)}

      <div class="group-card" style="background: var(--bg-card); border: 1px solid {complete ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 9px; padding: 10px 11px; {complete ? 'box-shadow: 0 0 10px rgba(201,168,76,0.07);' : ''}">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 7px; margin-bottom: 7px; padding-bottom: 6px; border-bottom: 1px solid var(--border);">
          <div style="width: 22px; height: 22px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--gold);">{group}</div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase;">Grupo {group}</span>
          {#if allLocked}
            <span style="margin-left: auto; font-size: 9px; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 1px 7px; border-radius: 10px;">🔒</span>
          {:else if complete}
            <span style="margin-left: auto; font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 1px 7px; border-radius: 10px;">✓</span>
          {:else}
            <span style="margin-left: auto; font-size: 9px; color: var(--text-dim); background: rgba(255,255,255,0.04); padding: 1px 7px; border-radius: 10px;">{entered}/6</span>
          {/if}
        </div>

        <!-- Fixtures: pick 1 / X / 2 (quiniela style), in chronological order.
             Date on the left (shown when it changes), time on the right. -->
        <div style="display: flex; flex-direction: column; gap: 3px;">
          {#each fixtures as match, i}
            {@const mLocked = match.locked || effectivelyLocked}
            {@const dayChanged = i === 0 || dayKey(match.kickoff) !== dayKey(fixtures[i - 1]?.kickoff)}
            {@const pick = getOutcome(match.id)}
            <div style="display: flex; align-items: center; gap: 5px; padding: 1px 0; {mLocked ? 'opacity: 0.55;' : ''}">
              <span style="font-size: 9px; color: var(--gold); width: 36px; flex-shrink: 0; text-transform: capitalize; line-height: 1.1;">{match.kickoff && dayChanged ? dateShort(match.kickoff) : ''}</span>
              <div style="flex: 1; display: flex; align-items: center; gap: 4px; justify-content: flex-end; min-width: 0;">
                <span style="font-size: 11px; font-weight: {pick === '1' ? '700' : '500'}; color: {pick === '1' ? 'var(--gold)' : 'var(--text)'}; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(match.home_name)}</span>
                <span style="font-size: 13px; flex-shrink: 0;">{@html flagEmoji(match.home_flag)}</span>
              </div>
              <div style="display: flex; align-items: stretch; gap: 2px; flex-shrink: 0;">
                {#each ['1', 'X', '2'] as o}
                  <button type="button" disabled={mLocked}
                    onclick={() => setOutcome(match.id, o)}
                    title={o === '1' ? 'Gana ' + shortName(match.home_name) : o === '2' ? 'Gana ' + shortName(match.away_name) : 'Empate'}
                    style="width: 24px; padding: 4px 0; font-size: 12px; font-weight: 700; border-radius: 5px; cursor: {mLocked ? 'default' : 'pointer'};
                      border: 1px solid {pick === o ? 'var(--gold)' : 'var(--border)'};
                      background: {pick === o ? 'var(--gold)' : 'var(--bg-surface)'};
                      color: {pick === o ? '#1a1305' : 'var(--text-muted)'};">{o}</button>
                {/each}
              </div>
              <div style="flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0;">
                <span style="font-size: 13px; flex-shrink: 0;">{@html flagEmoji(match.away_flag)}</span>
                <span style="font-size: 11px; font-weight: {pick === '2' ? '700' : '500'}; color: {pick === '2' ? 'var(--gold)' : 'var(--text)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(match.away_name)}</span>
              </div>
              <span style="font-size: 9px; color: var(--text-dim); width: 32px; flex-shrink: 0; text-align: right;">{#if match.locked}🔒{:else if match.kickoff}{timeLabel(match.kickoff)}{/if}</span>
            </div>
          {/each}
        </div>

        <!-- Derived standings -->
        <div style="margin-top: 8px; padding-top: 7px; border-top: 1px dashed var(--border);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
            <span style="font-size: 8px; color: var(--text-dim); letter-spacing: 0.1em; text-transform: uppercase;">Clasificación</span>
            {#if !complete}<span style="font-size: 8px; color: var(--text-dim); font-style: italic;">provisional</span>{/if}
          </div>
          {#if hasTie}
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px; padding: 4px 7px; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.3); border-radius: 5px; font-size: 9px; color: var(--gold); line-height: 1.3;">
              <span style="font-size: 11px;">⚖️</span>
              <span>Empate a puntos — usa las flechas <strong>▲▼</strong> para elegir el orden.</span>
            </div>
          {/if}
          <div style="display: flex; flex-direction: column; {complete ? '' : 'opacity: 0.7;'}">
            {#each ds.rows as row, i}
              {@const pos = i + 1}
              {@const accent = pos <= 2 ? 'var(--green)' : pos === 3 ? '#b87333' : 'var(--text-dim)'}
              {@const canUp = complete && !effectivelyLocked && row.ranked && i > 0 && ds.rows[i - 1].ranked && ds.rows[i - 1].points === row.points}
              {@const canDown = complete && !effectivelyLocked && row.ranked && i < ds.rows.length - 1 && ds.rows[i + 1].ranked && ds.rows[i + 1].points === row.points}
              <div style="display: flex; align-items: center; gap: 6px; padding: 2px 5px; border-radius: 4px; background: {pos <= 2 ? 'rgba(0,229,160,0.06)' : pos === 3 ? 'rgba(184,115,51,0.06)' : 'transparent'}; {pos === 2 ? 'border-bottom: 1px solid rgba(0,229,160,0.22);' : ''}">
                <span style="width: 13px; color: {accent}; font-size: 9px; font-weight: 800; flex-shrink: 0; text-align: center;">{pos}</span>
                <span style="font-size: 11px; font-weight: {pos <= 2 ? '600' : '400'}; color: {row.ranked ? 'var(--text)' : 'var(--text-dim)'}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><span style="font-size: 12px; margin-right: 4px;">{@html flagEmoji(row.team.flag_code)}</span>{shortName(row.team.name)}</span>
                {#if complete}<span style="font-size: 8px; color: var(--text-dim); flex-shrink: 0; min-width: 24px; text-align: right;">{row.points} pt{row.points === 1 ? '' : 's'}</span>{/if}
                {#if canUp || canDown}
                  <span style="display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; margin-left: 2px;" title="Empate a puntos — ordénalos a tu gusto">
                    <button type="button" aria-label="Subir" disabled={!canUp} onclick={() => moveTeam(group, i, -1)}
                      style="line-height: 0.7; font-size: 9px; padding: 1px 4px; border: 1px solid var(--border); border-radius: 3px; background: {canUp ? 'rgba(201,168,76,0.12)' : 'transparent'}; color: {canUp ? 'var(--gold)' : 'var(--text-dim)'}; cursor: {canUp ? 'pointer' : 'default'}; opacity: {canUp ? 1 : 0.35};">▲</button>
                    <button type="button" aria-label="Bajar" disabled={!canDown} onclick={() => moveTeam(group, i, 1)}
                      style="line-height: 0.7; font-size: 9px; padding: 1px 4px; border: 1px solid var(--border); border-radius: 3px; background: {canDown ? 'rgba(201,168,76,0.12)' : 'transparent'}; color: {canDown ? 'var(--gold)' : 'var(--text-dim)'}; cursor: {canDown ? 'pointer' : 'default'}; opacity: {canDown ? 1 : 0.35};">▼</button>
                  </span>
                {/if}
              </div>
            {/each}
          </div>
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

  <!-- Knockout note: the knockout is predicted on the bracket page (who advances
       + the final-score tiebreaker), not as per-match scorelines here. -->

  <!-- Bracket CTA -->
  {#if !effectivelyLocked && data.selectedId}
    <div style="margin-top: 20px; padding: 16px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 8px; text-align: center;">
      <p style="font-size: 12px; font-weight: 600; color: var(--gold); margin-bottom: 4px;">
        {#if groupsCompleted >= totalGroups}
          ✅ Grupos completos — ahora falta la 2.ª parte
        {:else}
          Aún no has terminado: falta el cuadro eliminatorio
        {/if}
      </p>
      <p style="font-size: 10px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
        Elige quién avanza en el cuadro y predice el marcador de la final.{#if knockoutDeadlineText} Se bloquea el <strong style="color: var(--gold);">{knockoutDeadlineText}</strong>.{:else} Se bloquea en la fecha límite.{/if}
      </p>
      <a href={`/pool/${pool.id}/bracket${data.selectedId ? `?entry=${data.selectedId}` : ''}`} class="btn-primary" style="font-size: 11px; padding: 10px 24px; display: inline-block; text-decoration: none;">⚔️ Ir al Cuadro Eliminatorio →</a>
    </div>
  {/if}
</div>

<style>
  .group-card { min-width: 0; }
</style>
