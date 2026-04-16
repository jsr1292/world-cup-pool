<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let { data } = $props();

  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const POSITION_LABELS = ['1º', '2º', '3º', '4º'];

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

  // Selections state
  let selections = $state({});
  $effect(() => {
    const sel = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      sel[group] = {
        pos1: existing.pos1 ?? null,
        pos2: existing.pos2 ?? null,
        pos3: existing.pos3 ?? null,
        pos4: existing.pos4 ?? null,
      };
    }
    selections = sel;
  });

  let saving = $state(false);
  let saved = $state(false);
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');

  function selectTeam(group, position, teamId) {
    const num = Number(teamId) || null;
    if (num !== null) {
      for (const pos of ['pos1', 'pos2', 'pos3', 'pos4']) {
        if (selections[group][pos] === num && pos !== position) {
          selections[group][pos] = null;
        }
      }
    }
    selections[group][position] = num;
  }

  async function savePredictions() {
    saving = true;
    saved = false;
    try {
      const res = await fetch('/api/predictions/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_id: data.selectedId,
          groups: selections,
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
        // Navigate to the new entry
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
      'United States': 'USA',
      'South Korea': 'S. Korea',
      'South Africa': 'S. Africa',
      'New Zealand': 'N. Zealand',
      'Cape Verde': 'Cape Verde',
      'Czech Republic': 'Czechia',
      'Saudi Arabia': 'S. Arabia',
      'Bosnia and Herzegovina': 'Bosnia',
      'DR Congo': 'DR Congo',
      'North Macedonia': 'N. Macedonia',
    };
    return map[name] || name;
  }
</script>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Volver a la quiniela
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Pronósticos de Fase de Grupos</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Predice la clasificación final de cada grupo. Selecciona del 1º al 4º puesto.
    </p>

    <!-- Deadline warning -->
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

      <!-- Dropdown for switching entries -->
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

      <!-- Create new entry button -->
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
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const groupTeams = data.teamsByGroup[group] || []}
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">
            {group}
          </div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Grupo {group}</span>
        </div>

        <!-- Position selectors -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          {#each POSITION_LABELS as label, pi}
            {@const posKey = `pos${pi + 1}`}
            {@const selectedTeamId = selections[group]?.[posKey]}
            {@const selectedTeam = groupTeams.find(t => t.id === selectedTeamId)}
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 22px; font-size: 10px; font-weight: 600; color: {pi === 0 ? 'var(--gold)' : pi === 1 ? '#c0c0c0' : pi === 2 ? '#cd7f32' : 'var(--text-dim)'}; text-align: center;">
                {pi + 1}
              </div>
              <select
                disabled={data.isLocked}
                onchange={(e) => selectTeam(group, posKey, e.target.value)}
                style="flex: 1; padding: 6px 8px; font-size: 11px; text-align: left; background: rgba(0,0,0,0.3); {selectedTeam ? 'color: var(--text); border-color: rgba(201,168,76,0.3);' : 'color: var(--text-muted);'}"
              >
                <option value="">Selecciona {label}</option>
                {#each groupTeams as team}
                  <option value={team.id} selected={selectedTeamId === team.id}>
                    {flagEmoji(team.flag_code)} {shortName(team.name)}
                  </option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Save button -->
  {#if !data.isLocked}
    <div style="margin-top: 24px; display: flex; gap: 12px; align-items: center;">
      <button
        class="btn-primary"
        disabled={saving}
        onclick={savePredictions}
      >
        {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar Pronósticos'}
      </button>
      {#if saved}
        <span style="font-size: 10px; color: var(--green);">¡Pronósticos de grupos guardados!</span>
      {/if}
    </div>
  {/if}
</div>
