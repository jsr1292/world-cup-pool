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

  // selections[group][position] = teamId
  // position 1-4, teamId is the database id
  let selections = $state({});
  $effect(() => {
    const sel = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      sel[group] = {
        1: existing.pos1 ?? null,
        2: existing.pos2 ?? null,
        3: existing.pos3 ?? null,
        4: existing.pos4 ?? null,
      };
    }
    selections = sel;
  });

  // Which team is currently in a given position?
  function teamAt(group, position) {
    return selections[group]?.[position] ?? null;
  }

  // Which position is a given team in? (null if not assigned)
  function positionOf(group, teamId) {
    if (!teamId) return null;
    const map = selections[group] || {};
    for (const [pos, tid] of Object.entries(map)) {
      if (Number(tid) === Number(teamId)) return Number(pos);
    }
    return null;
  }

  // Toggle: tap position button assigns team to that position
  // If team is already in another position, swap them
  function togglePosition(group, position, teamId) {
    const current = selections[group]?.[position];

    if (Number(current) === Number(teamId)) {
      // Deselect: already there, clear it
      selections[group][position] = null;
    } else {
      // Check if this team is already somewhere else — swap
      const existingPos = positionOf(group, teamId);
      if (existingPos !== null) {
        // Swap: kick the team out of its old position, put in new one
        selections[group][existingPos] = current;
        selections[group][position] = teamId;
      } else {
        // Check if target position has a different team — replace it
        selections[group][position] = teamId;
      }
    }
    autoSave();
  }

  let saving = $state(false);
  let saved = $state(false);
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');

  let autoSaveTimer = null;
  function autoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(savePredictions, 500);
  }

  async function savePredictions() {
    saving = true;
    saved = false;
    try {
      // Convert position→teamId back to pos1/pos2/pos3/pos4
      const groups = {};
      for (const group of GROUP_NAMES) {
        groups[group] = {
          pos1: selections[group]?.[1] ?? null,
          pos2: selections[group]?.[2] ?? null,
          pos3: selections[group]?.[3] ?? null,
          pos4: selections[group]?.[4] ?? null,
        };
      }
      const res = await fetch('/api/predictions/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_id: data.selectedId,
          groups,
        }),
      });
      if (res.ok) {
        saved = true;
        setTimeout(() => saved = false, 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      saving = false;
    }
  }

  async function switchEntry(label) {
    const url = new URL($page.url);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    await goto(url.pathname + url.search, { invalidateAll: true });
  }

  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true;
    createMsg = '';
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        newEntryLabel = '';
        createMsg = '';
        await goto(`/pool/${pool.id}/predict?entry=${encodeURIComponent(d.label)}`, { invalidateAll: true });
      } else {
        createMsg = d.error || 'Error';
      }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }

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

  // Medal colors for positions 1-3
  const MEDAL = { 1: '#c9a84c', 2: '#a0a0a0', 3: '#b87333' };
  const POS_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
</script>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Volver a la quiniela
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Pronósticos de Fase de Grupos</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Pulsa el número junto a cada equipo para asignar su posición (1º a 4º) en el grupo.
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
        <select
          value={data.selectedLabel}
          onchange={(e) => switchEntry(e.target.value)}
          style="font-size: 11px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text);"
        >
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
        <button
          onclick={() => { newEntryLabel = ''; createMsg = ''; }}
          style="font-size: 9px; padding: 6px 12px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;"
        >
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
          <input
            bind:value={newEntryLabel}
            placeholder="Ej: Apuesta conservadora, Emoción..."
            style="width: 100%; font-size: 12px; padding: 8px 10px;"
            onkeydown={(e) => { if (e.key === 'Enter') createEntry(); }}
          />
        </div>
        <button onclick={createEntry} disabled={creating || !newEntryLabel.trim()} class="btn-primary" style="font-size: 9px; padding: 8px 16px; white-space: nowrap;">
          {creating ? 'Creando...' : 'Crear'}
        </button>
        <button onclick={() => { newEntryLabel = ''; createMsg = ''; }} style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">
          ✕
        </button>
      </div>
      {#if createMsg}
        <div style="margin-top: 8px; font-size: 10px; color: var(--red);">{createMsg}</div>
      {/if}
    </div>
  {/if}

  <!-- Group prediction cards -->
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const groupTeams = data.teamsByGroup[group] || []}

      <!-- Teams list (prediction = order they appear when position assigned) -->
      <!-- Sort: teams with a position first, then unassigned -->
      {@const sortedTeams = [...groupTeams].sort((a, b) => {
        const pa = positionOf(group, a.id);
        const pb = positionOf(group, b.id);
        if (pa !== null && pb !== null) return pa - pb;
        if (pa !== null) return -1;
        if (pb !== null) return 1;
        return 0;
      })}

      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">
            {group}
          </div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>
          <!-- Position legend -->
          <div style="margin-left: auto; display: flex; gap: 3px;">
            {#each [1,2,3,4] as pos}
              <div style="
                width: 18px; height: 18px; border-radius: 4px;
                display: flex; align-items: center; justify-content: center;
                font-size: 9px; font-weight: 700;
                background: {pos <= 3 ? MEDAL[pos] + '22' : 'rgba(255,255,255,0.05)'};
                color: {pos <= 3 ? MEDAL[pos] : 'var(--text-dim)'};
                border: 1px solid {pos <= 3 ? MEDAL[pos] + '44' : 'var(--border)'};
              ">{pos}</div>
            {/each}
          </div>
        </div>

        <!-- Team rows -->
        <div style="display: flex; flex-direction: column; gap: 5px;">
          {#each sortedTeams as team (team.id)}
            {@const myPos = positionOf(group, team.id)}
            <div style="
              display: flex; align-items: center; gap: 6px;
              padding: 5px 6px;
              border-radius: 6px;
              background: {myPos ? 'rgba(201,168,76,0.06)' : 'transparent'};
              border: 1px solid {myPos ? 'rgba(201,168,76,0.2)' : 'transparent'};
              transition: all 0.15s ease;
            ">
              <!-- Position buttons -->
              <div style="display: flex; gap: 3px; flex-shrink: 0;">
                {#each [1,2,3,4] as pos}
                  <button
                    disabled={data.isLocked}
                    onclick={() => togglePosition(group, pos, team.id)}
                    title={POS_LABEL[pos]}
                    style="
                      width: 22px; height: 22px; border-radius: 5px;
                      display: flex; align-items: center; justify-content: center;
                      font-size: 10px; font-weight: 700;
                      border: 1.5px solid {myPos === pos ? MEDAL[pos] : 'var(--border)'};
                      background: {myPos === pos ? MEDAL[pos] : 'transparent'};
                      color: {myPos === pos ? (pos === 1 ? '#3d2a00' : '#fff') : MEDAL[pos] || 'var(--text-dim)'};
                      cursor: pointer;
                      transition: all 0.1s ease;
                      padding: 0;
                    "
                  >{pos}</button>
                {/each}
              </div>

              <!-- Team info -->
              <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;">
                {#if myPos}
                  <div style="
                    width: 16px; height: 16px; border-radius: 50%;
                    background: {MEDAL[myPos]};
                    display: flex; align-items: center; justify-content: center;
                    font-size: 8px; font-weight: 800;
                    color: {myPos === 1 ? '#3d2a00' : '#fff'};
                    flex-shrink: 0;
                  ">{myPos}</div>
                {:else}
                  <div style="width: 16px; height: 16px; flex-shrink: 0;"></div>
                {/if}
                <span style="font-size: 11px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  {flagEmoji(team.flag_code)} {shortName(team.name)}
                </span>
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

  <!-- Go to bracket -->
  {#if !data.isLocked && data.selectedId}
    <div style="margin-top: 20px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; text-align: center;">
      <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Grupos completados — ahora predice las eliminatorias</p>
      <a href="/pool/{pool.id}/bracket" class="btn-primary" style="font-size: 11px; padding: 10px 24px; display: inline-block; text-decoration: none;">⚔️ Cuadro Eliminatorio →</a>
    </div>
  {/if}
</div>
