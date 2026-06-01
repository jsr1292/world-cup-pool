<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import { showToast } from '$lib/toast';
  import { flagEmoji, shortName } from '$lib/teams.js';

  let { data } = $props();

  const GROUP_NAMES = $derived(
    data.presentGroups?.length > 0
      ? data.presentGroups
      : ['A','B','C','D','E','F','G','H','I','J','K','L']
  );
  const totalGroups = $derived(GROUP_NAMES.length);
  const pool = $derived(data.pool);
  const allowMultiple = $derived(!!data.pool.allow_multiple_predictions);

  // Progress tracking
  const groupsCompleted = $derived.by(() => {
    return GROUP_NAMES.filter(g => {
      const arr = selections[g] || [];
      return arr[0] != null && arr[1] != null && arr[2] != null && arr[3] != null;
    }).length;
  });
  const progressPct = $derived(Math.round((groupsCompleted / totalGroups) * 100));

  // Deadline countdown
  let countdown = $state('');
  // 8a: Client-side lock — true if server locked at page load OR if countdown reached zero
  const effectivelyLocked = $derived(data.isLocked || countdown === 'Cerrado');
  // A specific group whose matches have already started/finished — predictions
  // for it can no longer be saved (the server drops them), so lock it in the UI.
  const isGroupStarted = (group) => data.lockedGroups?.includes(group) ?? false;
  const isGroupLocked = (group) => effectivelyLocked || isGroupStarted(group);
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

  // selections[group] = ordered array of teamIds [pos1, pos2, pos3, pos4]
  // Re-derive initial state when data changes (entry switch via soft navigation)
  const selectionsInit = $derived.by(() => {
    const init = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      init[group] = [
        existing.pos1 ?? null,
        existing.pos2 ?? null,
        existing.pos3 ?? null,
        existing.pos4 ?? null,
      ];
    }
    return init;
  });
  let selections = $state(JSON.parse(JSON.stringify(selectionsInit)));

  // Active drag/save operations track which groups are being actively edited
  // so we don't overwrite user's in-flight changes with stale server data
  const _activeEdits = new Set();

  $effect(() => {
    // Depend on selectionsInit only; mutate `selections` inside untrack so the
    // write doesn't re-trigger this effect (which would loop infinitely).
    const fresh = JSON.parse(JSON.stringify(selectionsInit));
    untrack(() => {
      for (const [group, ranks] of Object.entries(fresh)) {
        if (!_activeEdits.has(group)) {
          selections[group] = ranks;
        }
      }
    });
  });

  // ─── Mobile: sequential tap-to-rank ───────────────────────────────

  const POS_LABEL = ['1º', '2º', '3º', '4º'];
  const POS_FULL = ['1º puesto', '2º puesto', '3º puesto', '4º puesto'];

  function nextSlot(group) {
    const arr = selections[group] || [];
    return arr.findIndex(s => !s);
  }

  function tapTeam(group, teamId) {
    const arr = [...(selections[group] || [null, null, null, null])];
    const currentPos = arr.findIndex(t => Number(t) === Number(teamId));

    if (currentPos >= 0) {
      // Unrank this team — compact remaining picks to avoid interior nulls
      arr.splice(currentPos, 1);
      arr.push(null);
    } else {
      // Assign to next available slot
      const slot = arr.findIndex(s => !s);
      if (slot >= 0) {
        arr[slot] = teamId;
      }
    }
    selections[group] = arr;
    _activeEdits.add(group);
    autoSave();
  }

  function resetGroup(group) {
    selections[group] = [null, null, null, null];
    _activeEdits.delete(group);
    autoSave();
  }

  // ─── Desktop: native HTML5 drag-to-reorder ────────────────────────────

  let draggingGroup = $state(null);
  let draggingSlot = $state(null);
  let dragOverGroup = $state(null);   // group currently hovered (for highlight)
  let dragOverSlot = $state(null);    // slot index hovered over

  function handleDragStart(e, group, slotIndex) {
    if (effectivelyLocked) return;
    draggingGroup = group;
    draggingSlot = slotIndex;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `slot:${group}:${slotIndex}`);
  }

  function handleDragStartUnassigned(e, group, teamId) {
    if (effectivelyLocked) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `team:${group}:${teamId}`);
  }

  function handleDragOver(e, group, slotIndex) {
    if (effectivelyLocked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverGroup = group;
    dragOverSlot = slotIndex;
  }

  function handleDragLeave() {
    dragOverGroup = null;
    dragOverSlot = null;
  }

  function handleDrop(e, group, slotIndex) {
    if (effectivelyLocked) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const parts = raw.split(':');
    const type = parts[0]; // 'slot' or 'team'

    const arr = [...(selections[group] || [null, null, null, null])];

    if (type === 'team') {
      // Dragging an unranked team from the pool onto a slot — POSITIONAL: it
      // lands exactly where you drop it (drop on 4th → 4th), not snapped to the
      // first free slot. If it was ranked elsewhere, vacate that slot; any team
      // already in the target slot returns to the pool. Partial groups (gaps)
      // are fine — they save, and only filled positions are scored.
      const srcGroup = parts[1];
      const teamId = Number(parts[2]);
      if (srcGroup !== group) return;
      const existing = arr.findIndex(t => Number(t) === teamId);
      if (existing >= 0) arr[existing] = null;
      arr[slotIndex] = teamId;
      selections[group] = arr;
      _activeEdits.add(group);
      autoSave();
    } else {
      // Dragging from one ranked slot to another — POSITIONAL swap.
      const srcGroup = parts[1];
      const srcSlot = parseInt(parts[2]);
      if (srcGroup !== group || srcSlot === slotIndex) {
        draggingGroup = null; draggingSlot = null; dragOverGroup = null; dragOverSlot = null;
        return;
      }
      if (arr[srcSlot] === null) {
        draggingGroup = null; draggingSlot = null; dragOverGroup = null; dragOverSlot = null;
        return;
      }
      const tmp = arr[srcSlot];
      arr[srcSlot] = arr[slotIndex];
      arr[slotIndex] = tmp;
      selections[group] = arr;
      _activeEdits.add(group);
      autoSave();
    }

    draggingGroup = null;
    draggingSlot = null;
    dragOverSlot = null;
  }

  function handleDragEnd() {
    draggingGroup = null;
    draggingSlot = null;
    dragOverGroup = null;
    dragOverSlot = null;
  }

  // ─── Save ─────────────────────────────────────────────────────────────

  let saving = $state(false);
  let saved = $state(false);
  let autoSaveTimer = null;

  function autoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(savePredictions, 600);
  }

  async function savePredictions() {
    saving = true;
    saved = false;
    try {
      const groups = {};
      for (const group of GROUP_NAMES) {
        const arr = selections[group] || [];
        // DATA-LOSS FIX: only send groups that actually have a team assigned.
        // The server DELETEs any group it receives empty, and this autosave used
        // to send ALL 12 groups every time — so a transient/stale empty state on
        // one client (e.g. after switching devices mid-prediction) silently wiped
        // groups already saved by another device (the "Group A vanished" bug).
        // Never transmitting empty groups means the server only ever upserts real
        // picks and can never delete them behind your back.
        if (!arr.some(v => v != null)) continue;
        groups[group] = {
          pos1: arr[0] ?? null,
          pos2: arr[1] ?? null,
          pos3: arr[2] ?? null,
          pos4: arr[3] ?? null,
        };
      }
      // Nothing with data to save — don't fire a request the server would 400.
      if (Object.keys(groups).length === 0) { saving = false; return; }
      const res = await fetch('/api/predictions/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, groups }),
      });
      if (res.ok) { saved = true; _activeEdits.clear(); setTimeout(() => saved = false, 2000); }
      else {
        const body = await res.json().catch(() => ({}));
        showToast('⚠️ ' + (body.error || 'Error al guardar — inténtalo de nuevo'));
      }
    } catch (e) {
      console.error(e);
      showToast('⚠️ Error al guardar — inténtalo de nuevo');
    }
    finally { saving = false; }
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
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
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

  // ─── Helpers ───────────────────────────────────────────────────────────

  const MEDAL = { 0: '#c9a84c', 1: '#a0a0a0', 2: '#b87333' };

  function teamAt(group, slot) {
    const teamId = selections[group]?.[slot];
    if (!teamId) return null;
    return (data.teamsByGroup[group] || []).find(t => Number(t.id) === Number(teamId));
  }

  function unassignedTeams(group) {
    const assigned = new Set((selections[group] || []).filter(Boolean).map(Number));
    return (data.teamsByGroup[group] || []).filter(t => !assigned.has(Number(t.id)));
  }

  function isDragging(group, slot) {
    return draggingGroup === group && draggingSlot === slot;
  }

  function isDropTarget(group, slot) {
    return dragOverGroup === group && dragOverSlot === slot && !(draggingGroup === group && draggingSlot === slot);
  }
</script>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Volver a la quiniela
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Pronósticos de Fase de Grupos</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Ordena los equipos de cada grupo del 1º al 4º puesto.
      <span class="desktop-hint" style="color: var(--gold); margin-left: 6px;">← Haz clic o arrastra para clasificar</span>
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

  <!-- Group prediction cards -->
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const groupTeams = data.teamsByGroup[group] || []}
      {@const _selArr = selections[group] || []}
      {@const groupDone = _selArr[0] != null && _selArr[1] != null && _selArr[2] != null && _selArr[3] != null}

      <!-- ── Desktop: native drag-to-reorder ──────────────────────── -->
      <div class="desktop-view group-card" style="background: var(--bg-card); border: 1px solid {groupDone ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 8px; padding: 14px; {groupDone ? 'box-shadow: 0 0 12px rgba(201,168,76,0.08);' : ''}">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">{group}</div>
          {#if groupDone}<span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span><span style="color: var(--green); font-size: 11px;"> ✓</span>{:else}<span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>{/if}
          {#if isGroupStarted(group)}
            <span style="margin-left: auto; font-size: 9px; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 10px;">🔒 Cerrado</span>
          {:else if groupDone}
            <span style="margin-left: auto; font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 2px 8px; border-radius: 10px;">✓ Completo</span>
          {/if}
        </div>

        <!-- Slot rows — each slot is a drop target -->
        {#if isGroupLocked(group)}
          <div style="display: flex; flex-direction: column; gap: 4px;">
            {#each [0,1,2,3] as slot}
              {@const team = teamAt(group, slot)}
              <div style="display: flex; align-items: center; gap: 8px; padding: 10px 8px; border-radius: 6px; background: {slot < 3 ? MEDAL[slot] + '15' : 'rgba(255,255,255,0.03)'}; border: 1px solid {slot < 3 ? MEDAL[slot] + '33' : 'transparent'};">
                <div style="width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; background: {slot < 3 ? MEDAL[slot] : 'rgba(255,255,255,0.1)'}; color: {slot === 0 ? '#3d2a00' : slot < 3 ? '#fff' : 'var(--text-dim)'}; flex-shrink: 0;">{slot + 1}</div>
                {#if team}
                  <span style="font-size: 11px; font-weight: 500; color: var(--text);"><span style="font-size: 16px; margin-right: 4px;">{@html flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
                {:else}
                  <span style="font-size: 11px; color: var(--text-dim); border: 1px dashed var(--border); padding: 2px 8px; border-radius: 4px;">—</span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <!-- Draggable slot rows -->
          {#each [0,1,2,3] as slot}
            {@const team = teamAt(group, slot)}
            {@const isDraggingThis = isDragging(group, slot)}
            {@const isDropTargetThis = isDropTarget(group, slot)}
            <div
              style="
                display: flex; align-items: center; gap: 8px;
                padding: 7px 8px; border-radius: 6px;
                background: {isDraggingThis ? 'rgba(201,168,76,0.03)' : slot < 3 && team ? (MEDAL[slot] + '15') : 'rgba(255,255,255,0.03)'};
                border: 1.5px solid {isDropTargetThis ? 'var(--gold)' : isDraggingThis ? 'rgba(201,168,76,0.4)' : slot < 3 && team ? (MEDAL[slot] + '33') : 'transparent'};
                opacity: {isDraggingThis ? '0.4' : '1'};
                transition: border-color 0.1s, background 0.1s, opacity 0.1s;
              "
              role={team ? 'button' : undefined}
              title={team ? 'Haz clic para quitar' : undefined}
              onclick={() => { if (team && !effectivelyLocked) tapTeam(group, team.id); }}
              draggable={team !== null}
              ondragstart={(e) => handleDragStart(e, group, slot)}
              ondragover={(e) => handleDragOver(e, group, slot)}
              ondragleave={handleDragLeave}
              ondrop={(e) => handleDrop(e, group, slot)}
              ondragend={handleDragEnd}
            >
              <div style="width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; background: {slot < 3 && team ? MEDAL[slot] : 'rgba(255,255,255,0.1)'}; color: {slot === 0 && team ? '#3d2a00' : slot < 3 && team ? '#fff' : 'var(--text-dim)'}; flex-shrink: 0;">{slot + 1}</div>
              <div style="color: var(--text-dim); font-size: 14px; flex-shrink: 0; cursor: {team ? 'grab' : 'default'}; line-height: 1;">☰</div>
              {#if team}
                <span style="font-size: 11px; font-weight: 500; color: var(--text);"><span style="font-size: 16px; margin-right: 4px;">{@html flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
              {:else}
                <span style="font-size: 11px; color: var(--text-dim); border: 1px dashed var(--border); padding: 2px 8px; border-radius: 4px;">—</span>
              {/if}
            </div>
          {/each}

          <!-- Unassigned teams pool -->
          {#if unassignedTeams(group).length > 0}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);">
              <div style="font-size: 8px; color: var(--text-dim); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px;">Sin asignar</div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                {#each unassignedTeams(group) as team}
                  <button
                    type="button"
                    draggable={true}
                    disabled={effectivelyLocked}
                    title="Haz clic para asignar al siguiente puesto"
                    onclick={() => { if (!effectivelyLocked) tapTeam(group, team.id); }}
                    ondragstart={(e) => handleDragStartUnassigned(e, group, team.id)}
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); cursor: pointer; font-size: 11px; color: var(--text);"
                  >
                    <span style="font-size: 14px;">{@html flagEmoji(team.flag_code)}</span>
                    {shortName(team.name)}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- ── Mobile: sequential tap-to-rank ──────────────────────── -->
      <div class="mobile-view group-card" style="background: var(--bg-card); border: 1px solid {groupDone ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 12px; padding: 16px; {groupDone ? 'box-shadow: 0 0 12px rgba(201,168,76,0.08);' : ''}">
        <!-- Group header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: var(--gold);">{group}</div>
            <span style="font-size: 12px; font-weight: 600; color: var(--text); letter-spacing: 0.04em;">Grupo {group}</span>
          </div>
          {#if isGroupStarted(group)}
            <span style="font-size: 9px; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 10px; font-weight: 500;">🔒 Cerrado</span>
          {:else if groupDone}
            <span style="font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 3px 10px; border-radius: 10px; font-weight: 500;">✓ Completo</span>
          {:else}
            <button
              disabled={effectivelyLocked}
              onclick={() => resetGroup(group)}
              style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; font-size: 9px; color: var(--text-dim); cursor: pointer; {selections[group]?.some(s => s) ? '' : 'opacity: 0.3; pointer-events: none;'}"
            >Reset</button>
          {/if}
        </div>

        <!-- Instruction -->
        {#if !groupDone && !isGroupLocked(group)}
          {@const ns = nextSlot(group)}
          <div style="font-size: 10px; color: var(--gold); margin-bottom: 10px; padding: 6px 10px; background: rgba(201,168,76,0.08); border-radius: 6px; text-align: center;">
            Toca el equipo que quedar&aacute; <strong>{POS_FULL[ns] || ''}</strong>
          </div>
        {/if}

        <!-- Team list -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          {#each [...groupTeams].sort((a, b) => {
            const ra = selections[group]?.findIndex(t => Number(t) === Number(a.id));
            const rb = selections[group]?.findIndex(t => Number(t) === Number(b.id));
            if (ra >= 0 && rb >= 0) return ra - rb;
            if (ra >= 0) return -1;
            if (rb >= 0) return 1;
            return 0;
          }) as team (team.id)}
            {@const rank = selections[group]?.findIndex(t => Number(t) === Number(team.id))}
            {@const isRanked = rank >= 0}
            {@const isNext = !groupDone && !isRanked}
            <button
              disabled={isGroupLocked(group) || (!isRanked && groupDone)}
              onclick={() => tapTeam(group, team.id)}
              style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1.5px solid {isRanked ? MEDAL[rank] + '88' : isNext ? 'rgba(255,255,255,0.08)' : 'transparent'}; background: {isRanked ? MEDAL[rank] + '15' : isNext ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)'}; cursor: pointer; transition: all 0.2s; width: 100%; text-align: left; {isRanked ? 'opacity: 1;' : isNext ? 'opacity: 0.9;' : 'opacity: 0.35;'}"
            >
              <!-- Rank badge -->
              {#if isRanked}
                <div style="width: 26px; height: 26px; border-radius: 50%; background: {MEDAL[rank]}; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: {rank === 0 ? '#3d2a00' : '#fff'}; flex-shrink: 0;">{rank + 1}</div>
              {:else}
                <div style="width: 26px; height: 26px; border-radius: 50%; border: 1.5px dashed {isNext ? 'var(--border)' : 'transparent'}; flex-shrink: 0;"></div>
              {/if}
              <!-- Team info -->
              <span style="font-size: 13px; font-weight: {isRanked ? '600' : '400'}; color: var(--text); flex: 1;"><span style="font-size: 20px; margin-right: 6px;">{@html flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
              {#if isRanked}
                <span style="font-size: 14px; color: var(--text-dim); opacity: 0.5;">×</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

    {/each}
  </div>

  <!-- Knockout Match Scores Section -->
  {#if Object.keys(data.knockoutByPhase || {}).length > 0}
    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border);">
      <div style="margin-bottom: 16px;">
        <h2 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold); margin-bottom: 4px;">⚽ Resultados de Eliminatorias</h2>
        <p style="font-size: 10px; color: var(--text-muted);">Predice el marcador exacto de cada partido eliminado.</p>
        <p style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          Resultado (1/X/2): <strong style="color: var(--gold);">+1</strong> · + diferencia de goles: <strong style="color: var(--gold);">+1</strong> · marcador exacto: <strong style="color: var(--gold);">+3</strong>
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

  <!-- Auto-save indicator -->
  {#if !effectivelyLocked}
    <div style="margin-top: 24px; display: flex; gap: 12px; align-items: center;">
      {#if saving}
        <span style="font-size: 10px; color: var(--text-muted);">Guardando...</span>
      {:else if saved}
        <span style="font-size: 10px; color: var(--green);">✓ Guardado</span>
      {:else}
        <span style="font-size: 10px; color: var(--text-dim);">Cambios guardados automáticamente</span>
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
  .desktop-view { display: none; }
  .mobile-view { display: flex; flex-direction: column; }

  @media (hover: hover) and (pointer: fine) {
    .desktop-view { display: flex; flex-direction: column; }
    .mobile-view { display: none; }
    .desktop-hint { display: inline; }
  }

  @media (hover: none) and (pointer: coarse) {
    .desktop-hint { display: none; }
  }
</style>
