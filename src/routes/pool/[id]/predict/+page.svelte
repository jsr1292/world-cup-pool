<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let { data } = $props();

  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const pool = data.pool;
  const allowMultiple = pool.allow_multiple_predictions === 1;

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
  let selections = $state({});
  $effect(() => {
    const sel = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      sel[group] = [
        existing.pos1 ?? null,
        existing.pos2 ?? null,
        existing.pos3 ?? null,
        existing.pos4 ?? null,
      ];
    }
    selections = sel;
  });

  // ─── Mobile: tap-to-rank ───────────────────────────────────────────────

  function posOf(group, teamId) {
    if (!teamId) return null;
    return (selections[group] || []).findIndex(t => Number(t) === Number(teamId));
  }

  function toggleSlot(group, slotIndex, teamId) {
    const arr = [...(selections[group] || [])];
    const current = arr[slotIndex];

    if (Number(current) === Number(teamId)) {
      arr[slotIndex] = null;
    } else {
      const existingIdx = posOf(group, teamId);
      if (existingIdx !== null) {
        arr[existingIdx] = current;
      } else {
        arr[slotIndex] = teamId;
      }
    }
    selections[group] = arr;
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
    e.dataTransfer.setData('text/plain', `${group}:${slotIndex}`);
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
    const data2 = e.dataTransfer.getData('text/plain');
    const [srcGroup, srcSlotStr] = data2.split(':');
    const srcSlot = parseInt(srcSlotStr);
    const srcGroup2 = srcGroup;

    if (srcGroup2 !== group || srcSlot === slotIndex) {
      draggingGroup = null;
      draggingSlot = null;
      dragOverSlot = null;
      return;
    }

    // Reorder: move team at srcSlot to slotIndex, shift others
    const arr = [...(selections[group] || [])];
    const movingTeamId = arr[srcSlot];
    if (movingTeamId === null) {
      draggingGroup = null; draggingSlot = null; dragOverGroup = null; dragOverSlot = null;
      return;
    }
    // Remove from source
    arr.splice(srcSlot, 1);
    // Insert at target
    arr.splice(slotIndex, 0, movingTeamId);
    selections[group] = arr;
    autoSave();

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

  // ─── Helpers ───────────────────────────────────────────────────────────

  function flagEmoji(code) {
    if (!code) return '';
    if (code === 'GB-ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (code === 'GB-SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
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
  const POS_LABEL = ['1st', '2nd', '3rd', '4th'];

  function teamAt(group, slot) {
    const teamId = selections[group]?.[slot];
    if (!teamId) return null;
    return (data.teamsByGroup[group] || []).find(t => Number(t.id) === Number(teamId));
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

      <!-- ── Desktop: native drag-to-reorder ──────────────────────── -->
      <div class="desktop-view group-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">{group}</div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>
          <div style="margin-left: auto; display: flex; gap: 3px;">
            {#each [0,1,2,3] as si}
              <div style="width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; background: {si <= 2 ? MEDAL[si] + '22' : 'rgba(255,255,255,0.05)'}; color: {si <= 2 ? MEDAL[si] : 'var(--text-dim)'}; border: 1px solid {si <= 2 ? MEDAL[si] + '44' : 'var(--border)'};">{si + 1}</div>
            {/each}
          </div>
        </div>

        <!-- Slot rows — each slot is a drop target -->
        {#if data.isLocked}
          <div style="display: flex; flex-direction: column; gap: 4px;">
            {#each [0,1,2,3] as slot}
              {@const team = teamAt(group, slot)}
              <div style="display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; background: {slot < 3 ? MEDAL[slot] + '15' : 'rgba(255,255,255,0.03)'}; border: 1px solid {slot < 3 ? MEDAL[slot] + '33' : 'transparent'};">
                <div style="width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; background: {slot < 3 ? MEDAL[slot] : 'rgba(255,255,255,0.1)'}; color: {slot === 0 ? '#3d2a00' : slot < 3 ? '#fff' : 'var(--text-dim)'}; flex-shrink: 0;">{slot + 1}</div>
                {#if team}
                  <span style="font-size: 11px; font-weight: 500; color: var(--text);">{flagEmoji(team.flag_code)} {shortName(team.name)}</span>
                {:else}
                  <span style="font-size: 11px; color: var(--text-dim); font-style: italic;">Vacío</span>
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
                <span style="font-size: 11px; font-weight: 500; color: var(--text);">{flagEmoji(team.flag_code)} {shortName(team.name)}</span>
              {:else}
                <span style="font-size: 11px; color: var(--text-dim); font-style: italic;">Vacío — arrastra aquí</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- ── Mobile: tap-to-rank ─────────────────────────────────── -->
      <div class="mobile-view group-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">{group}</div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>
          <div style="margin-left: auto; display: flex; gap: 3px;">
            {#each [0,1,2,3] as si}
              <div style="width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; background: {si <= 2 ? MEDAL[si] + '22' : 'rgba(255,255,255,0.05)'}; color: {si <= 2 ? MEDAL[si] : 'var(--text-dim)'}; border: 1px solid {si <= 2 ? MEDAL[si] + '44' : 'var(--border)'};">{si + 1}</div>
            {/each}
          </div>
        </div>

        <!-- All teams in group, sorted: assigned first, then unassigned -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          {#each [...groupTeams].sort((a, b) => { const pa = posOf(group, a.id); const pb = posOf(group, b.id); if (pa !== null && pb !== null) return pa - pb; if (pa !== null) return -1; if (pb !== null) return 1; return 0; }) as team (team.id)}
            {@const mySlot = posOf(group, team.id)}
            {@const isSelected = mySlot !== null}
            <div style="display: flex; align-items: center; gap: 5px; padding: 5px 6px; border-radius: 6px; background: {isSelected ? 'rgba(201,168,76,0.06)' : 'transparent'}; border: 1px solid {isSelected ? 'rgba(201,168,76,0.2)' : 'transparent'}; transition: all 0.15s;">
              <!-- Tap buttons 1-4 -->
              <div style="display: flex; gap: 2px; flex-shrink: 0;">
                {#each [0,1,2,3] as si}
                  <button
                    disabled={data.isLocked}
                    onclick={() => toggleSlot(group, si, team.id)}
                    title={POS_LABEL[si]}
                    style="width: 24px; height: 24px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 1.5px solid {mySlot === si ? MEDAL[si] : 'var(--border)'}; background: {mySlot === si ? MEDAL[si] : 'transparent'}; color: {mySlot === si ? (si === 0 ? '#3d2a00' : '#fff') : MEDAL[si] || 'var(--text-dim)'}; cursor: pointer; transition: all 0.1s; padding: 0;"
                  >{si + 1}</button>
                {/each}
              </div>
              <!-- Team info + position badge -->
              <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;">
                {#if isSelected}
                  <div style="width: 16px; height: 16px; border-radius: 50%; background: {MEDAL[mySlot]}; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; color: {mySlot === 0 ? '#3d2a00' : '#fff'}; flex-shrink: 0;">{mySlot + 1}</div>
                {:else}
                  <div style="width: 16px; height: 16px; flex-shrink: 0;"></div>
                {/if}
                <span style="font-size: 11px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{flagEmoji(team.flag_code)} {shortName(team.name)}</span>
              </div>
            </div>
          {/each}
        </div>
      </div>

    {/each}
  </div>

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
