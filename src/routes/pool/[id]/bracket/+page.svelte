<script>
  import { showToast } from '$lib/toast';
  import { haptic } from '$lib/haptic';
  import { headerTitle } from '$lib/stores/header';
  let { data } = $props();

  $effect(() => {
    headerTitle.set({ text: 'Mi Quiniela', emoji: '⚔️', showBack: true, poolName: data.pool?.name, poolEmoji: data.pool?.emoji || '⚔️' });
    return () => { headerTitle.set({ text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null }); };
  });

  const R32_MAP = [
    { t1g: 'A', t1p: 1, t2g: 'B', t2p: 2 },
    { t1g: 'C', t1p: 1, t2g: 'D', t2p: 2 },
    { t1g: 'E', t1p: 1, t2g: 'F', t2p: 2 },
    { t1g: 'G', t1p: 1, t2g: 'H', t2p: 2 },
    { t1g: 'I', t1p: 1, t2g: 'J', t2p: 2 },
    { t1g: 'K', t1p: 1, t2g: 'L', t2p: 2 },
    { t1g: 'B', t1p: 1, t2g: 'A', t2p: 2 },
    { t1g: 'D', t1p: 1, t2g: 'C', t2p: 2 },
    { t1g: 'F', t1p: 1, t2g: 'E', t2p: 2 },
    { t1g: 'H', t1p: 1, t2g: 'G', t2p: 2 },
    { t1g: 'J', t1p: 1, t2g: 'I', t2p: 2 },
    { t1g: 'L', t1p: 1, t2g: 'K', t2p: 2 },
    { t1g: '?', t1p: 1, t2g: '?', t2p: 2 },
    { t1g: '?', t1p: 1, t2g: '?', t2p: 2 },
    { t1g: '?', t1p: 1, t2g: '?', t2p: 2 },
    { t1g: '?', t1p: 1, t2g: '?', t2p: 2 },
  ];

  const PHASES = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];

  // Use a version counter to force reactivity
  let version = $state(0);

  // Store state in plain objects (not $state) - reactivity via version
  let _teams = {};
  let _picks = {}; // explicitPicks

  function bump() { version++; }

  // Build team map from data
  const teamMap = $derived.by(() => {
    const map = {};
    if (data.teamsByGroup) {
      for (const gTeams of Object.values(data.teamsByGroup)) {
        for (const t of gTeams) map[t.id] = t;
      }
    }
    return map;
  });

  function getGroupTeam(group, pos) {
    const gp = data.groupPredictions?.[group];
    if (gp) {
      const id = [gp.pos1, gp.pos2, gp.pos3, gp.pos4][pos - 1];
      if (id) return id;
    }
    // Fallback: use default team order from teamsByGroup
    const gTeams = data.teamsByGroup?.[group];
    if (gTeams && gTeams.length >= pos) return gTeams[pos - 1].id;
    return null;
  }

  // Count how many groups have explicit predictions
  const groupsPredicted = $derived.by(() => {
    const groups = 'ABCDEFGHIJKL'.split('');
    return groups.filter(g => data.groupPredictions?.[g]?.pos1).length;
  });

  // Initialize state from server data
  function initState() {
    const t = {};
    const exp = {};

    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      const team1 = m.t1g !== '?' ? getGroupTeam(m.t1g, m.t1p) : null;
      const team2 = m.t2g !== '?' ? getGroupTeam(m.t2g, m.t2p) : null;
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
    for (let i = 0; i < 32; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.r32?.[slot]) {
        t.r32[mi][ti] = data.existingBracket.r32[slot];
        exp.r32[mi][ti] = true;
      }
    }

    const phaseSizes = { r16: 8, qf: 4, sf: 2, final: 1, '3rd': 1 };
    for (const [phase, size] of Object.entries(phaseSizes)) {
      t[phase] = Array.from({ length: size }, () => [null, null]);
      exp[phase] = Array.from({ length: size }, () => [false, false]);
      for (let i = 0; i < size * 2; i++) {
        const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
        if (data.existingBracket?.[phase]?.[slot]) {
          t[phase][mi][ti] = data.existingBracket[phase][slot];
          exp[phase][mi][ti] = true;
        }
      }
    }

    _teams = t;
    _picks = exp;
    recascade();
  }

  // Derive display state reactively based on version
  const teams = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_teams)); });
  const explicitPicks = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_picks)); });

  // Initialize once on mount - use untracked to avoid infinite loop
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    initState();
    bump();
  });

  function recascade() {
    // Restore R32 from group predictions
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      if (m.t1g === '?') continue;
      _teams.r32[i][0] = getGroupTeam(m.t1g, m.t1p);
      _teams.r32[i][1] = getGroupTeam(m.t2g, m.t2p);
    }

    // Cascade forward
    const cascades = [
      { from: 'r32', to: 'r16' },
      { from: 'r16', to: 'qf' },
      { from: 'qf', to: 'sf' },
      { from: 'sf', to: 'final' },
    ];
    for (const { from, to } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          if (!_picks[to][i][j]) {
            _teams[to][i][j] = getWinner(from, i * 2 + j);
          }
        }
      }
    }

    // 3rd place from SF losers
    if (!_picks['3rd'][0][0]) _teams['3rd'][0][0] = getLoser('sf', 0);
    if (!_picks['3rd'][0][1]) _teams['3rd'][0][1] = getLoser('sf', 1);
  }

  function getWinner(phase, matchIdx) {
    const m = _teams[phase]?.[matchIdx];
    if (!m) return null;
    const exp = _picks[phase]?.[matchIdx];
    if (exp?.[0]) return m[0];
    if (exp?.[1]) return m[1];
    return null;
  }

  function getLoser(phase, matchIdx) {
    const m = _teams[phase]?.[matchIdx];
    if (!m) return null;
    const exp = _picks[phase]?.[matchIdx];
    if (exp?.[0]) return m[1];
    if (exp?.[1]) return m[0];
    return null;
  }

  function animatePick(phase, matchIdx, teamIdx) {
    const btn = document.getElementById(`btn-${phase}-${matchIdx}-${teamIdx}`);
    if (!btn) return;
    btn.classList.add('team-pick');
    const origBg = btn.style.background;
    btn.style.background = 'rgba(201,168,76,0.15)';
    setTimeout(() => {
      btn.classList.remove('team-pick');
      btn.style.background = origBg;
    }, 200);
  }

  function pickTeam(phase, matchIdx, teamIdx, teamId) {
    haptic(10);
    animatePick(phase, matchIdx, teamIdx);
    const exp = _picks[phase][matchIdx];
    if (exp[teamIdx]) {
      // Undo
      exp[teamIdx] = false;
      exp[1 - teamIdx] = false;
    } else if (exp[1 - teamIdx]) {
      // Switch
      exp[1 - teamIdx] = false;
      exp[teamIdx] = true;
    } else {
      // Pick
      exp[teamIdx] = true;
    }
    recascade();
    bump();
    // Auto-save
    autoSaveBracket();
  }

  let autoSaveTimer = null;
  function autoSaveBracket() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveBracket, 800);
  }

  // ─── Tiebreaker ──────────────────────────────────────────────────
  let tieHome = $state(null);
  let tieAway = $state(null);
  let tieSaving = $state(false);
  let tieSaved = $state(false);

  async function loadTiebreaker() {
    if (!data.selectedId) return;
    try {
      const r = await fetch(`/api/predictions/tiebreaker?prediction_id=${data.selectedId}`);
      if (r.ok) {
        const d = await r.json();
        tieHome = d.home_score;
        tieAway = d.away_score;
      }
    } catch {}
  }

  let tieTimer = null;
  function onTieInput() {
    if (tieTimer) clearTimeout(tieTimer);
    tieTimer = setTimeout(saveTiebreaker, 800);
  }

  async function saveTiebreaker() {
    if (!data.selectedId) return;
    const h = tieHome !== null && tieHome !== '' ? Number(tieHome) : null;
    const a = tieAway !== null && tieAway !== '' ? Number(tieAway) : null;
    if (h === null || a === null || isNaN(h) || isNaN(a)) return;
    tieSaving = true; tieSaved = false;
    try {
      const r = await fetch('/api/predictions/tiebreaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, home_score: h, away_score: a }),
      });
      if (r.ok) { showToast('✓ Guardado'); }
    } catch {}
    tieSaving = false;
  }

  // Load tiebreaker on mount
  $effect(() => { loadTiebreaker(); });

  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state(null);
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');

  // Team path highlighting
  let hoveredTeam = $state(null); // team ID being hovered

  function getTeamPath(teamId) {
    // Trace a team's path through the bracket
    const path = new Set(); // set of 'round:matchIndex:teamIndex' keys
    if (!teamId) return path;

    // Find where this team appears in each round
    for (const round of ['r32', 'r16', 'qf', 'sf']) {
      const matches = _teams[round] || [];
      for (let mi = 0; mi < matches.length; mi++) {
        for (let ti = 0; ti < 2; ti++) {
          if (Number(matches[mi][ti]) === Number(teamId)) {
            path.add(`${round}:${mi}:${ti}`);
            // Also highlight the match card
            path.add(`${round}:${mi}`);
          }
        }
      }
    }
    // Final
    if (_teams.final?.[0]) {
      for (let ti = 0; ti < 2; ti++) {
        if (Number(_teams.final[0][ti]) === Number(teamId)) {
          path.add(`final:0:${ti}`);
          path.add(`final:0`);
        }
      }
    }
    return path;
  }

  const teamPath = $derived(getTeamPath(hoveredTeam));

  function isInPath(round, mi, ti = null) {
    if (!hoveredTeam) return false;
    if (ti !== null) return teamPath.has(`${round}:${mi}:${ti}`);
    return teamPath.has(`${round}:${mi}`);
  }

  async function saveBracket() {
    if (!data.selectedId) return;
    saving = true; saved = false;
    try {
      const picks = {};
      for (const phase of PHASES) {
        picks[phase] = {};
        const pt = _teams[phase];
        if (!pt) continue;
        for (let i = 0; i < pt.length; i++) {
          const exp = _picks[phase][i];
          for (let j = 0; j < 2; j++) {
            const slot = i * 2 + j + 1;
            picks[phase][slot] = exp[j] ? pt[i][j] : null;
          }
        }
      }
      const res = await fetch('/api/predictions/bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, picks }),
      });
      if (res.ok) { showToast('✓ Guardado'); }
      else { saveError = 'Error al guardar'; setTimeout(() => { saveError = null; }, 3000); }
    } catch (e) { console.error(e); }
    finally { saving = false; }
  }

  async function switchEntry(label) {
    const url = new URL(window.location.href);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    window.location.href = url.pathname + url.search;
  }

  async function createEntry() {
    if (!newEntryLabel.trim()) return;
    creating = true; createMsg = '';
    try {
      const res = await fetch('/api/predictions/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: data.pool.id, label: newEntryLabel.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        newEntryLabel = '';
        window.location.href = `/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`;
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
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + 127397)).join('');
  }

  function shortName(name) {
    const map = {
      'United States': 'USA', 'South Korea': 'S. Korea', 'South Africa': 'S. Africa',
      'Ivory Coast': "Côte d'Ivoire", 'New Zealand': 'N. Zealand', 'Cape Verde': 'Cape Verde',
      'Czech Republic': 'Czechia', 'Saudi Arabia': 'S. Arabia',
      'Bosnia and Herzegovina': 'Bosnia', 'DR Congo': 'DR Congo', 'North Macedonia': 'N. Macedonia',
    };
    return map[name] || (name ? name.substring(0, 14) : '');
  }

  function r32Label(mi) {
    const m = R32_MAP[mi];
    if (m.t1g === '?') return `3rd #${mi - 11}`;
    return `${m.t1g}${m.t1p} vs ${m.t2g}${m.t2p}`;
  }

  const totalPicks = $derived.by(() => {
    void version;
    let n = 0;
    for (const phase of PHASES) {
      const pt = _teams[phase];
      if (!pt) continue;
      for (const m of pt) {
        if (m[0] !== null) n++;
        if (m[1] !== null) n++;
      }
    }
    return n;
  });
</script>
<div class="bracket-page">
  <a href="/pool/{data.pool.id}" class="back-link">← Volver a la quiniela</a>

  <div class="bracket-header">
    <div>
      <h1 class="bracket-title">Cuadro Eliminatorio</h1>
      <p class="bracket-subtitle">Haz clic en una selección para elegirla ganadora. Haz clic de nuevo para deshacer.</p>
    </div>

    <!-- Entry selector -->
    {#if data.entries.length > 1 || (data.pool.allow_multiple_predictions === 1)}
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
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
          <span style="font-size: 11px; color: var(--gold); padding: 4px 8px; background: rgba(201,168,76,0.1); border-radius: 4px;">{data.entries[0].label}</span>
        {/if}
        {#if data.pool.allow_multiple_predictions === 1}
          <button onclick={() => { newEntryLabel = ''; createMsg = ''; }}
            style="font-size: 9px; padding: 6px 10px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;">
            + Nueva entrada
          </button>
        {/if}
      </div>
    {/if}

    {#if data.isLocked}
      <div class="lock-badge">⚠️ Bloqueado</div>
    {:else}
      <div class="save-area">
        <span class="pick-count">{totalPicks} picks</span>
        {#if saving}
          <span style="font-size: 10px; color: var(--text-muted);">Guardando...</span>
        {:else if saved}
          <span style="font-size: 10px; color: var(--green);">✓ Guardado</span>
        {:else}
          <span style="font-size: 10px; color: var(--text-dim);">Auto-guardado</span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Create entry form -->
  {#if data.pool.allow_multiple_predictions === 1 && newEntryLabel !== ''}
    <div style="margin-bottom: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--gold); border-radius: 8px; display: flex; gap: 8px; align-items: flex-end;">
      <div style="flex: 1;">
        <input bind:value={newEntryLabel} placeholder="Nombre de la entrada..."
          style="width: 100%; font-size: 12px; padding: 8px 10px;"
          onkeydown={(e) => { if (e.key === 'Enter') createEntry(); }} />
      </div>
      <button onclick={createEntry} disabled={creating || !newEntryLabel.trim()} class="btn-primary" style="font-size: 9px; padding: 8px 16px; white-space: nowrap;">{creating ? '...' : 'Crear'}</button>
      <button onclick={() => { newEntryLabel = ''; createMsg = ''; }} style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
      {#if createMsg}<span style="font-size: 10px; color: var(--red);">{createMsg}</span>{/if}
    </div>
  {/if}

  <!-- Warning: incomplete groups -->
  {#if groupsPredicted < 12}
    <div class="incomplete-banner">
      <span>⚠️ Grupos incompletos ({groupsPredicted}/12) — usando orden por defecto para los no rellenados.</span>
      <a href="/pool/{data.pool.id}/predict" style="color: var(--gold); text-decoration: underline; font-size: 10px;">Rellenar grupos →</a>
    </div>
  {/if}

  <!-- Bracket Grid -->
  <div class="bracket-scroll">
    <!-- Desktop: split bracket layout -->
    <div class="bracket-grid desktop-bracket">
      <!-- LEFT WING -->
      <div class="bracket-wing">
        <div class="bracket-col">
          <div class="col-header">Dieciseisavos</div>
          <div class="match-list r32-list">
            {#each (teams.r32 || []).slice(0, 8) as match, mi}
              {@const m = R32_MAP[mi]}
              {@const isPlaceholder = m.t1g === '?'}
              <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && !isPlaceholder && tid !== null}
                  <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r32', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else if isPlaceholder}<span class="team-tbd">TBD</span>{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">{r32Label(mi)}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Octavos</div>
          <div class="match-list r16-list">
            {#each (teams.r16 || []).slice(0, 4) as match, mi}
              <div class="match-card" class:path-highlight={isInPath('r16', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">R16-{mi + 1}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Cuartos</div>
          <div class="match-list qf-list">
            {#each (teams.qf || []).slice(0, 2) as match, mi}
              <div class="match-card" class:path-highlight={isInPath('qf', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">QF-{mi + 1}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Semifinal</div>
          <div class="match-list sf-list">
            {#each (teams.sf || []).slice(0, 1) as match, mi}
              <div class="match-card" class:path-highlight={isInPath('sf', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.sf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-sf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.sf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('sf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('sf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">SF-1</div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- CENTER: Final + 3rd place -->
      <div class="bracket-center">
        <div class="match-card match-final" class:path-highlight={isInPath('final', 0)}>
          <div class="col-header" style="margin-bottom: 8px;">🏆 Final</div>
          {#each [0, 1] as ti}
            {@const tid = teams.final?.[0]?.[ti]}
            {@const t = teamMap[tid]}
            {@const isPicked = explicitPicks.final?.[0]?.[ti]}
            {@const canClick = !data.isLocked && tid !== null}
            <button id={"btn-final-0-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.final?.[0]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('final', 0, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('final', 0, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
              {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
            </button>
          {/each}
        </div>
        <div class="match-card match-3rd" class:path-highlight={isInPath('3rd', 0)}>
          <div class="match-label-3rd">3er puesto</div>
          {#each [0, 1] as ti}
            {@const tid = teams['3rd']?.[0]?.[ti]}
            {@const t = teamMap[tid]}
            {@const isPicked = explicitPicks['3rd']?.[0]?.[ti]}
            {@const canClick = !data.isLocked && tid !== null}
            <button id={"btn-3rd-0-"+ti} class="team-btn" class:picked={isPicked} class:path-highlight={isInPath('3rd', 0, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('3rd', 0, ti, tid)}>
              {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
            </button>
          {/each}
        </div>
      </div>

      <!-- RIGHT WING (reversed: SF, QF, R16, R32) -->
      <div class="bracket-wing">
        <div class="bracket-col">
          <div class="col-header">Semifinal</div>
          <div class="match-list sf-list">
            {#each (teams.sf || []).slice(1, 2) as match, idx}
              {@const mi = idx + 1}
              <div class="match-card" class:path-highlight={isInPath('sf', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.sf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-sf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.sf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('sf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('sf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">SF-2</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Cuartos</div>
          <div class="match-list qf-list">
            {#each (teams.qf || []).slice(2, 4) as match, idx}
              {@const mi = idx + 2}
              <div class="match-card" class:path-highlight={isInPath('qf', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">QF-{mi + 1}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Octavos</div>
          <div class="match-list r16-list">
            {#each (teams.r16 || []).slice(4, 8) as match, idx}
              {@const mi = idx + 4}
              <div class="match-card" class:path-highlight={isInPath('r16', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">R16-{mi + 1}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="bracket-col">
          <div class="col-header">Dieciseisavos</div>
          <div class="match-list r32-list">
            {#each (teams.r32 || []).slice(8, 16) as match, idx}
              {@const mi = idx + 8}
              {@const m = R32_MAP[mi]}
              {@const isPlaceholder = m.t1g === '?'}
              <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && !isPlaceholder && tid !== null}
                  <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r32', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else if isPlaceholder}<span class="team-tbd">TBD</span>{:else}<span class="team-empty">—</span>{/if}
                  </button>
                {/each}
                <div class="match-label">{r32Label(mi)}</div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile: linear layout (original) -->
    <div class="bracket-grid mobile-bracket">
      <div class="bracket-col">
        <div class="col-header">Dieciseisavos</div>
        <div class="match-list r32-list">
          {#each (teams.r32 || []) as match, mi}
            {@const m = R32_MAP[mi]}
            {@const isPlaceholder = m.t1g === '?'}
            <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && !isPlaceholder && tid !== null}
                <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r32', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                  {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else if isPlaceholder}<span class="team-tbd">TBD</span>{:else}<span class="team-empty">—</span>{/if}
                </button>
              {/each}
              <div class="match-label">{r32Label(mi)}</div>
            </div>
          {/each}
        </div>
      </div>
      <div class="bracket-col">
        <div class="col-header">Octavos</div>
        <div class="match-list r16-list">
          {#each (teams.r16 || []) as match, mi}
            <div class="match-card" class:path-highlight={isInPath('r16', mi)}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                  {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                </button>
              {/each}
              <div class="match-label">R16-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>
      <div class="bracket-col">
        <div class="col-header">Cuartos</div>
        <div class="match-list qf-list">
          {#each (teams.qf || []) as match, mi}
            <div class="match-card" class:path-highlight={isInPath('qf', mi)}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                  {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                </button>
              {/each}
              <div class="match-label">QF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>
      <div class="bracket-col">
        <div class="col-header">Semifinales</div>
        <div class="match-list sf-list">
          {#each (teams.sf || []) as match, mi}
            <div class="match-card" class:path-highlight={isInPath('sf', mi)}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.sf?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button id={"btn-sf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.sf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('sf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('sf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                  {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                </button>
              {/each}
              <div class="match-label">SF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>
      <div class="bracket-col">
        <div class="col-header">Final</div>
        <div class="match-list final-list">
          <div class="match-card match-final" class:path-highlight={isInPath('final', 0)}>
            {#each [0, 1] as ti}
              {@const tid = teams.final?.[0]?.[ti]}
              {@const t = teamMap[tid]}
              {@const isPicked = explicitPicks.final?.[0]?.[ti]}
              {@const canClick = !data.isLocked && tid !== null}
              <button id={"btn-final-0-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.final?.[0]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('final', 0, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('final', 0, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
              </button>
            {/each}
            <div class="match-label match-label-final">🏆 FINAL</div>
          </div>
          <div class="match-card match-3rd" class:path-highlight={isInPath('3rd', 0)}>
            <div class="match-label-3rd">3er puesto</div>
            {#each [0, 1] as ti}
              {@const tid = teams['3rd']?.[0]?.[ti]}
              {@const t = teamMap[tid]}
              {@const isPicked = explicitPicks['3rd']?.[0]?.[ti]}
              {@const canClick = !data.isLocked && tid !== null}
              <button id={"btn-3rd-0-"+ti} class="team-btn" class:picked={isPicked} class:path-highlight={isInPath('3rd', 0, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('3rd', 0, ti, tid)}>
                {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
              </button>
            {/each}
            <div class="match-label">3ER</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- Legend -->
  <div class="bracket-legend">
    <span class="legend-item"><span class="pick-star">★</span> Tu elección</span>
    <span class="legend-item"><span class="legend-match">A1 vs B2</span> Enfrentamiento de grupo</span>
    <span class="legend-item"><span class="legend-tbd">TBD</span> Clasificados de 3er puesto</span>
  </div>

  <!-- Tiebreaker: predicted final score -->
  <div class="tiebreaker-card">
    <div class="tiebreaker-title">🏆 Desempate: Resultado de la Final</div>
    <div class="tiebreaker-subtitle">Si hay empate a puntos, gana quien más se acerque al resultado final.</div>
    <div class="tiebreaker-inputs">
      <div class="tiebreaker-team">
        <span style="font-size: 11px; color: var(--text-dim); margin-bottom: 4px;">Local</span>
        <input
          type="number"
          min="0"
          max="30"
          bind:value={tieHome}
          oninput={onTieInput}
          placeholder="-"
          disabled={data.isLocked}
          class="tiebreaker-input"
        />
      </div>
      <span class="tiebreaker-dash">—</span>
      <div class="tiebreaker-team">
        <span style="font-size: 11px; color: var(--text-dim); margin-bottom: 4px;">Visitante</span>
        <input
          type="number"
          min="0"
          max="30"
          bind:value={tieAway}
          oninput={onTieInput}
          placeholder="-"
          disabled={data.isLocked}
          class="tiebreaker-input"
        />
      </div>
    </div>
    <div style="margin-top: 6px; font-size: 10px;">
      {#if tieSaving}<span style="color: var(--text-muted);">Guardando...</span>
      {:else if tieSaved}<span style="color: var(--green);">✓ Guardado</span>
      {:else if tieHome !== null && tieAway !== null}<span style="color: var(--text-dim);">Auto-guardado</span>
      {:else}<span style="color: var(--text-dim);">Opcional</span>{/if}
    </div>
  </div>
</div>

<style>
  .bracket-page {
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }

  .back-link {
    font-size: 11px;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 16px;
  }

  .bracket-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 24px;
  }

  .bracket-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--gold);
  }

  .bracket-subtitle {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .lock-badge {
    padding: 8px 12px;
    background: rgba(255, 77, 106, 0.1);
    border: 1px solid var(--red);
    border-radius: 6px;
    font-size: 11px;
    color: var(--red);
    white-space: nowrap;
  }

  .save-area {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .incomplete-banner {
    margin-bottom: 16px;
    padding: 10px 14px;
    background: rgba(255, 152, 0, 0.08);
    border: 1px solid rgba(255, 152, 0, 0.3);
    border-radius: 6px;
    font-size: 11px;
    color: #ffb020;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .pick-count {
    font-size: 11px;
    color: var(--text-dim);
  }

  /* Bracket grid */
  .bracket-scroll {
    overflow-x: auto;
    padding-bottom: 16px;
  }

  .bracket-grid {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    min-width: 900px;
  }

  /* Desktop: split bracket */
  .mobile-bracket { display: none; }
  .desktop-bracket {
    display: flex;
    align-items: stretch;
    gap: 8px;
    min-width: 1100px;
  }
  .bracket-wing {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  .bracket-wing .bracket-col {
    flex: 1 1 0;
    min-width: 0;
  }
  .bracket-center {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 150px;
    justify-content: center;
    padding: 0 8px;
    border-left: 1px solid rgba(201,168,76,0.15);
    border-right: 1px solid rgba(201,168,76,0.15);
  }
  .bracket-center .match-final {
    border: 1.5px solid rgba(201,168,76,0.3);
    box-shadow: 0 0 20px rgba(201,168,76,0.08);
  }

  /* Team path highlighting */
  .match-card.path-highlight {
    border-color: rgba(201, 168, 76, 0.4) !important;
    box-shadow: 0 0 12px rgba(201, 168, 76, 0.15);
    transition: all 0.15s ease;
  }
  .team-btn.path-highlight {
    background: rgba(201, 168, 76, 0.12) !important;
    border-color: rgba(201, 168, 76, 0.3) !important;
  }

  @media (max-width: 768px) {
    .desktop-bracket { display: none !important; }
    .mobile-bracket { display: flex !important; }
  }

  .bracket-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .col-header {
    text-align: center;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 10px;
    background: rgba(201, 168, 76, 0.12);
    border: 1px solid rgba(201, 168, 76, 0.25);
    border-radius: 4px;
    padding: 5px 10px;
    width: 100%;
    max-width: 140px;
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(8px);
  }

  /* Match lists with proper spacing between rounds */
  .match-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 140px;
  }

  /* Connector lines between rounds */
  .bracket-col:not(:first-child)::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 8px;
    height: 1px;
    background: rgba(255,255,255,0.08);
  }
  .bracket-col { position: relative; }

  .r32-list { gap: 4px; }
  .r16-list { gap: 10px; }
  .qf-list { gap: 28px; }
  .sf-list { gap: 70px; }
  .final-list { gap: 20px; }

  /* Vertically center each column */
  .bracket-col {
    justify-content: center;
    min-height: 0;
  }

  .match-list {
    justify-content: center;
    flex: 1;
  }

  /* Match cards */
  .match-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    width: 100%;
  }

  .match-card.placeholder {
    opacity: 0.5;
    border-color: rgba(100, 100, 100, 0.2);
  }

  .match-card.match-final {
    border-color: rgba(201, 168, 76, 0.3);
    background: rgba(201, 168, 76, 0.06);
  }

  .match-card.match-3rd {
    border-color: var(--border);
  }

  .match-label-3rd {
    text-align: center;
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    padding: 3px 4px 0;
  }

  /* Team buttons */
  .team-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    width: 100%;
    color: var(--text);
    font-size: 11px;
    font-family: inherit;
    transition: background 0.12s, opacity 0.12s;
  }

  .team-btn:first-child {
    border-top: none;
  }

  .team-btn:not(:disabled):hover {
    background: rgba(201, 168, 76, 0.2);
  }

  .team-btn.picked {
    background: rgba(201, 168, 76, 0.15);
  }

  .team-btn.picked:not(:disabled):hover {
    background: rgba(201, 168, 76, 0.25);
  }

  .team-btn.eliminated {
    opacity: 0.35;
    text-decoration: line-through;
  }

  .team-btn:disabled {
    cursor: default;
  }

  /* Final match bigger */
  .match-final .team-btn {
    padding: 8px 10px;
    font-size: 13px;
    gap: 6px;
  }

  .match-3rd .team-btn {
    padding: 7px 9px;
    font-size: 12px;
  }

  .team-flag {
    flex-shrink: 0;
  }

  .match-final .team-flag { font-size: 15px; }
  .match-3rd .team-flag { font-size: 13px; }

  .team-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .match-final .team-name {
    font-weight: 600;
    color: var(--gold-light);
  }

  .pick-star {
    color: var(--gold);
    font-size: 10px;
    flex-shrink: 0;
  }

  .match-final .pick-star { font-size: 12px; }

  .team-tbd {
    color: var(--text-dim);
    font-style: italic;
    font-size: 10px;
  }

  .team-empty {
    color: var(--text-dim);
    font-style: italic;
    font-size: 10px;
    flex: 1;
  }

  .match-label {
    text-align: center;
    font-size: 8px;
    color: var(--text-dim);
    padding: 2px 4px;
    border-top: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.2);
  }

  .match-label-final {
    color: var(--gold);
    letter-spacing: 0.1em;
    background: rgba(0, 0, 0, 0.3);
  }

  /* Legend */
  .bracket-legend {
    margin-top: 24px;
    display: flex;
    gap: 20px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 10px;
    color: var(--text-dim);
  }

  .tiebreaker-card {
    margin-top: 24px;
    padding: 16px 20px;
    background: var(--bg-card);
    border: 1px solid rgba(201, 168, 76, 0.2);
    border-radius: 8px;
  }

  .tiebreaker-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--gold);
    margin-bottom: 4px;
  }

  .tiebreaker-subtitle {
    font-size: 10px;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .tiebreaker-inputs {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .tiebreaker-team {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .tiebreaker-input {
    width: 60px;
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
  }

  .tiebreaker-input:focus {
    border-color: var(--gold);
    outline: none;
  }

  .tiebreaker-input::placeholder {
    color: var(--text-dim);
  }

  .tiebreaker-dash {
    font-size: 20px;
    color: var(--text-muted);
    margin-top: 16px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-match {
    background: rgba(201, 168, 76, 0.12);
    border: 1px solid rgba(201, 168, 76, 0.25);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 8px;
    color: var(--gold);
  }

  .legend-tbd {
    opacity: 0.5;
    border: 1px solid rgba(100, 100, 100, 0.2);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 8px;
  }

  /* Desktop: expand to fill screen */
  @media (min-width: 1200px) {
    .bracket-grid {
      min-width: unset;
      gap: 12px;
    }

    .col-header {
      max-width: 180px;
      font-size: 11px;
      padding: 6px 14px;
    }

    .match-list {
      max-width: 180px;
    }

    .team-btn {
      padding: 8px 10px;
      font-size: 13px;
    }

    .match-final .team-btn {
      padding: 10px 14px;
      font-size: 15px;
    }

    .team-flag { font-size: 15px; }
    .match-final .team-flag { font-size: 18px; }
    .team-name { font-size: 13px; }
    .match-final .team-name { font-size: 15px; }
    .pick-star { font-size: 12px; }
    .match-final .pick-star { font-size: 14px; }

    .match-label { font-size: 9px; padding: 3px 6px; }

    .bracket-title { font-size: 24px; }
    .bracket-subtitle { font-size: 13px; }
  }

  @media (max-width: 600px) {
    .team-btn {
      padding: 10px 10px;
      font-size: 11px;
      gap: 4px;
      min-height: 44px;
    }

    .team-flag { font-size: 15px; }
    .team-name { font-size: 11px; }

    .match-list { gap: 6px; }
    .match-card { min-width: 110px; }

    .bracket-title { font-size: 16px; }
    .col-header { font-size: 9px; padding: 4px 8px; }

    .bracket-scroll {
      -webkit-overflow-scrolling: touch;
      padding-bottom: 24px;
    }

    .bracket-grid {
      min-width: 950px;
      gap: 4px;
    }

    .match-final .team-btn {
      min-height: 48px;
      font-size: 13px;
    }

    .tiebreaker-input {
      width: 64px;
      font-size: 20px;
      padding: 10px;
    }
  }

  /* Tap feedback for bracket picks */
  @keyframes pickPulse {
    0% { transform: scale(1); }
    50% { transform: scale(0.95); }
    100% { transform: scale(1); }
  }
  :global(.team-pick) {
    animation: pickPulse 0.2s ease;
  }
</style>