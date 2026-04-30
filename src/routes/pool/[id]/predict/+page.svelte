<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let { data } = $props();

  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const pool = data.pool;
  const allowMultiple = pool.allow_multiple_predictions === 1;

  // Progress tracking
  const groupsCompleted = $derived.by(() => {
    return GROUP_NAMES.filter(g => {
      const gp = data.existingGroupPreds?.[g];
      return gp?.pos1 && gp?.pos2 && gp?.pos3 && gp?.pos4;
    }).length;
  });
  const progressPct = $derived(Math.round((groupsCompleted / 12) * 100));

  // Deadline countdown
  let countdown = $state('');
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
  // Initialize synchronously so mutations are immediately reactive
  let _initSel = {};
  for (const group of GROUP_NAMES) {
    const existing = data.existingGroupPreds?.[group] || {};
    _initSel[group] = [
      existing.pos1 ?? null,
      existing.pos2 ?? null,
      existing.pos3 ?? null,
      existing.pos4 ?? null,
    ];
  }
  let selections = $state(_initSel);

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
      // Unrank this team
      arr[currentPos] = null;
    } else {
      // Assign to next available slot
      const slot = arr.findIndex(s => !s);
      if (slot >= 0) {
        arr[slot] = teamId;
      }
    }
    selections[group] = arr;
    autoSave();
  }

  function resetGroup(group) {
    selections[group] = [null, null, null, null];
    autoSave();
  }

  // ─── Desktop: native HTML5 drag-to-reorder ────────────────────────────

  let draggingGroup = $state(null);
  let draggingSlot = $state(null);
  let dragOverGroup = $state(null);   // group currently hovered (for highlight)
  let dragOverSlot = $state(null);    // slot index hovered over

  function handleDragStart(e, group, slotIndex) {
    if (data.isLocked) return;
    draggingGroup = group;
    draggingSlot = slotIndex;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `slot:${group}:${slotIndex}`);
  }

  function handleDragStartUnassigned(e, group, teamId) {
    if (data.isLocked) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `team:${group}:${teamId}`);
  }

  function handleDragOver(e, group, slotIndex) {
    if (data.isLocked) return;
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
    if (data.isLocked) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const parts = raw.split(':');
    const type = parts[0]; // 'slot' or 'team'

    const arr = [...(selections[group] || [null, null, null, null])];

    if (type === 'team') {
      // Dragging from unassigned pool
      const srcGroup = parts[1];
      const teamId = Number(parts[2]);
      if (srcGroup !== group) return;
      const target = arr[slotIndex] === null ? slotIndex : arr.findIndex(s => s === null);
      if (target === -1) return;
      arr[target] = teamId;
      selections[group] = arr;
      autoSave();
    } else {
      // Dragging from another slot
      const srcGroup = parts[1];
      const srcSlot = parseInt(parts[2]);
      if (srcGroup !== group || srcSlot === slotIndex) {
        draggingGroup = null; draggingSlot = null; dragOverGroup = null; dragOverSlot = null;
        return;
      }
      const movingTeamId = arr[srcSlot];
      if (movingTeamId === null) {
        draggingGroup = null; draggingSlot = null; dragOverGroup = null; dragOverSlot = null;
        return;
      }
      arr.splice(srcSlot, 1);
      arr.splice(slotIndex, 0, movingTeamId);
      selections[group] = arr;
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
        groups[group] = {
          pos1: arr[0] ?? null,
          pos2: arr[1] ?? null,
          pos3: arr[2] ?? null,
          pos4: arr[3] ?? null,
        };
      }
      const res = await fetch('/api/predictions/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, groups }),
      });
      if (res.ok) { saved = true; setTimeout(() => saved = false, 2000); }
    } catch (e) { console.error(e); }
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
  let _initMatchScores = {};
  for (const [matchId, score] of Object.entries(data.existingMatchPreds || {})) {
    _initMatchScores[Number(matchId)] = { home: score.home_score, away: score.away_score };
  }
  let matchScores = $state(_initMatchScores);
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
        scores[matchIdStr] = { home_score: score.home, away_score: score.away };
      }
      const res = await fetch('/api/predictions/match-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, scores }),
      });
      if (res.ok) { matchSaved = true; setTimeout(() => matchSaved = false, 2000); }
    } catch (e) { console.error(e); }
    finally { matchSaving = false; }
  }

  function setMatchScore(matchId, side, value) {
    const score = matchScores[matchId] || { home: null, away: null };
    if (side === 'home') score.home = value;
    else score.away = value;
    matchScores[matchId] = score;
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

  function flagEmoji(code) {
    if (!code) return '';
    if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (code.length !== 2) return '🏳️';
    const offset = 127397;
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + offset)).join('');
  }

  function shortName(name) {
    const map = {
      'United States': 'USA', 'South Korea': 'S. Korea', 'South Africa': 'S. Africa',
      'New Zealand': 'N. Zealand', 'Czech Republic': 'Czechia',
      'Saudi Arabia': 'S. Arabia', 'Bosnia and Herzegovina': 'Bosnia',
      'DR Congo': 'DR Congo', 'North Macedonia': 'N. Macedonia',
    };
    return map[name] || name;
  }

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
      Ordéna los equipos de cada grupo del 1º al 4º puesto.
      <span class="desktop-hint" style="color: var(--gold); margin-left: 6px;">← Arrastra para reordenar</span>
    </p>

    <!-- Progress bar -->
    <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">
      <div style="flex: 1; max-width: 280px; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden;">
        <div style="width: {progressPct}%; height: 100%; background: linear-gradient(90deg, var(--gold), #e8c96a); border-radius: 3px; transition: width 0.4s ease;"></div>
      </div>
      <span style="font-size: 10px; color: {groupsCompleted === 12 ? 'var(--green)' : 'var(--text-dim)'}; font-weight: 500; white-space: nowrap;">
        {groupsCompleted === 12 ? '✅' : ''} {groupsCompleted}/12 grupos
      </span>
    </div>

    {#if countdown && !data.isLocked}
      <div style="margin-top: 8px; padding: 8px 12px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 6px; font-size: 10px; color: var(--gold);">
        ⏰ Cierre en: {countdown}
      </div>
    {/if}
    {#if data.isLocked}
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
        <button onclick={() => { newEntryLabel = ''; createMsg = ''; }}
          style="font-size: 9px; padding: 6px 12px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;">
          + Nueva entrada
        </button>
      {/if}
    </div>
  {/if}

  <!-- Create entry inline form -->
  {#if allowMultiple && newEntryLabel !== undefined}
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
        <button onclick={() => { newEntryLabel = ''; createMsg = ''; }}
          style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
      </div>
      {#if createMsg}<div style="margin-top: 8px; font-size: 10px; color: var(--red);">{createMsg}</div>{/if}
    </div>
  {/if}

  <!-- Group prediction cards -->
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const groupTeams = data.teamsByGroup[group] || []}
      {@const gp = data.existingGroupPreds?.[group]}
      {@const groupDone = !!(gp?.pos1 && gp?.pos2 && gp?.pos3 && gp?.pos4)}

      <!-- ── Desktop: native drag-to-reorder ──────────────────────── -->
      <div class="desktop-view group-card" style="background: var(--bg-card); border: 1px solid {groupDone ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 8px; padding: 14px; {groupDone ? 'box-shadow: 0 0 12px rgba(201,168,76,0.08);' : ''}">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">{group}</div>
          {#if groupDone}<span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span><span style="color: var(--green); font-size: 11px;"> ✓</span>{:else}<span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>{/if}
          {#if groupDone}
            <span style="margin-left: auto; font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 2px 8px; border-radius: 10px;">✓ Completo</span>
          {/if}
        </div>

        <!-- Slot rows — each slot is a drop target -->
        {#if data.isLocked}
          <div style="display: flex; flex-direction: column; gap: 4px;">
            {#each [0,1,2,3] as slot}
              {@const team = teamAt(group, slot)}
              <div style="display: flex; align-items: center; gap: 8px; padding: 10px 8px; border-radius: 6px; background: {slot < 3 ? MEDAL[slot] + '15' : 'rgba(255,255,255,0.03)'}; border: 1px solid {slot < 3 ? MEDAL[slot] + '33' : 'transparent'};">
                <div style="width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; background: {slot < 3 ? MEDAL[slot] : 'rgba(255,255,255,0.1)'}; color: {slot === 0 ? '#3d2a00' : slot < 3 ? '#fff' : 'var(--text-dim)'}; flex-shrink: 0;">{slot + 1}</div>
                {#if team}
                  <span style="font-size: 11px; font-weight: 500; color: var(--text);"><span style="font-size: 16px; margin-right: 4px;">{flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
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
                <span style="font-size: 11px; font-weight: 500; color: var(--text);"><span style="font-size: 16px; margin-right: 4px;">{flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
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
                  <div
                    draggable={true}
                    ondragstart={(e) => handleDragStartUnassigned(e, group, team.id)}
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); cursor: grab; font-size: 11px; color: var(--text);"
                  >
                    <span style="font-size: 14px;">{flagEmoji(team.flag_code)}</span>
                    {shortName(team.name)}
                  </div>
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
          {#if groupDone}
            <span style="font-size: 9px; color: var(--green); background: rgba(0,229,160,0.1); padding: 3px 10px; border-radius: 10px; font-weight: 500;">✓ Completo</span>
          {:else}
            <button
              disabled={data.isLocked}
              onclick={() => resetGroup(group)}
              style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; font-size: 9px; color: var(--text-dim); cursor: pointer; {selections[group]?.some(s => s) ? '' : 'opacity: 0.3; pointer-events: none;'}"
            >Reset</button>
          {/if}
        </div>

        <!-- Instruction -->
        {#if !groupDone && !data.isLocked}
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
              disabled={data.isLocked || (!isRanked && groupDone)}
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
              <span style="font-size: 13px; font-weight: {isRanked ? '600' : '400'}; color: var(--text); flex: 1;"><span style="font-size: 20px; margin-right: 6px;">{flagEmoji(team.flag_code)}</span>{shortName(team.name)}</span>
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
          Acierta el resultado (1/X/2): <strong style="color: var(--gold);">+2 pts</strong> · Marcador exacto: <strong style="color: var(--gold);">+5 pts</strong>
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
                    <span style="font-size: 18px;">{flagEmoji(match.home_flag)}</span>
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
                      disabled={data.isLocked}
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
                      disabled={data.isLocked}
                      style="width: 40px; text-align: center; font-size: 16px; font-weight: 700; padding: 6px 4px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--gold);"
                    />
                  </div>

                  <!-- Away team -->
                  <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 18px;">{flagEmoji(match.away_flag)}</span>
                    <span style="font-size: 13px; font-weight: 500; color: var(--text);">{shortName(match.away_name)}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      <!-- Match scores auto-save indicator -->
      {#if !data.isLocked}
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
  {#if !data.isLocked}
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
  {#if !data.isLocked && data.selectedId}
    <div style="margin-top: 20px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; text-align: center;">
      <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Grupos completados — ahora predice las eliminatorias</p>
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
