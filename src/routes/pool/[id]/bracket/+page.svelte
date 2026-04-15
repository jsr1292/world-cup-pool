<script>
  let { data } = $props();

  const PHASES = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];

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

  let teams = $state({});
  let explicitPicks = $state({});
  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state(null);

  function buildTeamMap() {
    const map = {};
    if (data.teamsByGroup) {
      for (const gTeams of Object.values(data.teamsByGroup)) {
        for (const t of gTeams) map[t.id] = t;
      }
    }
    return map;
  }

  const teamMap = $derived(buildTeamMap());

  function getGroupTeam(group, pos) {
    const gp = data.groupPredictions?.[group];
    if (!gp) return null;
    return [gp.pos1, gp.pos2, gp.pos3, gp.pos4][pos - 1] ?? null;
  }

  $effect(() => {
    const t = {};
    const exp = {};

    // R32: derive from group predictions
    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      const team1 = m.t1g !== '?' ? getGroupTeam(m.t1g, m.t1p) : null;
      const team2 = m.t2g !== '?' ? getGroupTeam(m.t2g, m.t2p) : null;
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
    // Restore saved R32 picks
    for (let i = 0; i < 32; i++) {
      const slot = i + 1;
      const mi = Math.floor(i / 2);
      const ti = i % 2;
      if (data.existingBracket?.r32?.[slot]) {
        t.r32[mi][ti] = data.existingBracket.r32[slot];
        exp.r32[mi][ti] = true;
      }
    }

    // R16+
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

    teams = t;
    explicitPicks = exp;
    cascadeAll();
  });

  function cascadeAll() {
    // Step 1: Restore all R32 slots from group predictions first
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      if (m.t1g === '?') continue;
      teams.r32[i][0] = getGroupTeam(m.t1g, m.t1p);
      teams.r32[i][1] = getGroupTeam(m.t2g, m.t2p);
    }

    // Step 2: For explicitly picked R32 matches, override with the pick
    // (teams stay as-is; explicitPicks just marks who the winner is)

    // Step 3: Cascade winners forward
    const cascades = [
      { from: 'r32', to: 'r16', toSize: 8 },
      { from: 'r16', to: 'qf', toSize: 4 },
      { from: 'qf', to: 'sf', toSize: 2 },
      { from: 'sf', to: 'final', toSize: 1 },
    ];
    for (const { from, to, toSize } of cascades) {
      for (let i = 0; i < toSize; i++) {
        for (let j = 0; j < 2; j++) {
          if (!explicitPicks[to][i][j]) {
            teams[to][i][j] = getExplicitWinner(from, i * 2 + j);
          }
        }
      }
    }

    // Step 4: 3rd place from SF losers
    const sf0 = getExplicitLoser('sf', 0);
    const sf1 = getExplicitLoser('sf', 1);
    if (!explicitPicks['3rd'][0][0]) teams['3rd'][0][0] = sf0;
    if (!explicitPicks['3rd'][0][1]) teams['3rd'][0][1] = sf1;
  }

  function getExplicitWinner(phase, matchIdx) {
    const m = teams[phase]?.[matchIdx];
    if (!m) return null;
    const exp = explicitPicks[phase]?.[matchIdx];
    if (!exp) return null;
    if (exp[0]) return m[0]; // team 0 was explicitly picked as winner
    if (exp[1]) return m[1]; // team 1 was explicitly picked as winner
    return null; // no explicit pick → no winner yet
  }

  function getExplicitLoser(phase, matchIdx) {
    const m = teams[phase]?.[matchIdx];
    if (!m) return null;
    const exp = explicitPicks[phase]?.[matchIdx];
    if (!exp) return null;
    if (exp[0]) return m[1]; // team 0 won → team 1 lost
    if (exp[1]) return m[0]; // team 1 won → team 0 lost
    return null;
  }

  function pickTeam(phase, matchIdx, teamIdx, teamId) {
    const exp = explicitPicks[phase][matchIdx];
    if (exp[teamIdx]) {
      // This team is the winner → deselect (undo)
      exp[teamIdx] = false;
      exp[1 - teamIdx] = false;
    } else if (exp[1 - teamIdx]) {
      // Opponent is winner → switch pick to this team
      exp[1 - teamIdx] = false;
      exp[teamIdx] = true;
    } else {
      // No winner yet → pick this team
      exp[teamIdx] = true;
    }
    cascadeAll();
  }

  async function saveBracket() {
    saving = true;
    saved = false;
    try {
      const picks = {};
      for (const phase of PHASES) {
        picks[phase] = {};
        const pt = teams[phase];
        if (!pt) continue;
        for (let i = 0; i < pt.length; i++) {
          // Save winner per match (only 1 slot per match)
          const exp = explicitPicks[phase][i];
          for (let j = 0; j < 2; j++) {
            const slot = i * 2 + j + 1;
            // If this team was explicitly picked as winner, save their ID
            // Otherwise save null (cleared)
            if (exp[j]) {
              picks[phase][slot] = pt[i][j];
            } else {
              picks[phase][slot] = null;
            }
          }
        }
      }
      const res = await fetch('/api/predictions/bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.predictionId, picks }),
      });
      if (res.ok) {
        saved = true;
        setTimeout(() => { saved = false; }, 2500);
      } else {
        saveError = 'Save failed';
        setTimeout(() => { saveError = null; }, 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      saving = false;
    }
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
      'Ivory Coast': 'Côte d\'Ivoire', 'New Zealand': 'N. Zealand', 'Cape Verde': 'Cape Verde',
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
    let n = 0;
    for (const phase of PHASES) {
      const pt = teams[phase];
      if (!pt) continue;
      for (const m of pt) {
        if (m[0] !== null) n++;
        if (m[1] !== null) n++;
      }
    }
    return n;
  });
</script>

<!-- Header -->
<div class="bracket-page">
  <a href="/pool/{data.pool.id}" class="back-link">← Back to pool</a>

  <div class="bracket-header">
    <div>
      <h1 class="bracket-title">Knockout Bracket</h1>
      <p class="bracket-subtitle">Click a team to pick the winner. Click the winner again to undo.</p>
    </div>
    {#if data.isLocked}
      <div class="lock-badge">⚠️ Locked</div>
    {:else}
      <div class="save-area">
        <span class="pick-count">{totalPicks} picks</span>
        <button class="btn-primary" disabled={saving} onclick={saveBracket}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Bracket'}
        </button>
      </div>
    {/if}
  </div>

  <!-- Bracket Grid -->
  <div class="bracket-scroll">
    <div class="bracket-grid">

      <!-- R32 -->
      <div class="bracket-col">
        <div class="col-header">Round of 32</div>
        <div class="match-list r32-list">
          {#each (teams.r32 || []) as match, mi}
            {@const m = R32_MAP[mi]}
            {@const isPlaceholder = m.t1g === '?'}
            <div class="match-card" class:placeholder={isPlaceholder}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && !isPlaceholder && tid !== null}
                <button
                  class="team-btn"
                  class:picked={isPicked}
                  class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null}
                  disabled={!canClick}
                  onclick={() => canClick && pickTeam('r32', mi, ti, tid)}
                >
                  {#if t}
                    <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                    <span class="team-name">{shortName(t.name)}</span>
                    {#if isPicked}<span class="pick-star">★</span>{/if}
                  {:else if isPlaceholder}
                    <span class="team-tbd">TBD</span>
                  {:else}
                    <span class="team-empty">—</span>
                  {/if}
                </button>
              {/each}
              <div class="match-label">{r32Label(mi)}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- R16 -->
      <div class="bracket-col">
        <div class="col-header">Round of 16</div>
        <div class="match-list r16-list">
          {#each (teams.r16 || []) as match, mi}
            <div class="match-card">
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button
                  class="team-btn"
                  class:picked={isPicked}
                  class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null}
                  disabled={!canClick}
                  onclick={() => canClick && pickTeam('r16', mi, ti, tid)}
                >
                  {#if t}
                    <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                    <span class="team-name">{shortName(t.name)}</span>
                    {#if isPicked}<span class="pick-star">★</span>{/if}
                  {:else}
                    <span class="team-empty">—</span>
                  {/if}
                </button>
              {/each}
              <div class="match-label">R16-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- QF -->
      <div class="bracket-col">
        <div class="col-header">Quarterfinals</div>
        <div class="match-list qf-list">
          {#each (teams.qf || []) as match, mi}
            <div class="match-card">
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button
                  class="team-btn"
                  class:picked={isPicked}
                  class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null}
                  disabled={!canClick}
                  onclick={() => canClick && pickTeam('qf', mi, ti, tid)}
                >
                  {#if t}
                    <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                    <span class="team-name">{shortName(t.name)}</span>
                    {#if isPicked}<span class="pick-star">★</span>{/if}
                  {:else}
                    <span class="team-empty">—</span>
                  {/if}
                </button>
              {/each}
              <div class="match-label">QF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- SF -->
      <div class="bracket-col">
        <div class="col-header">Semifinals</div>
        <div class="match-list sf-list">
          {#each (teams.sf || []) as match, mi}
            <div class="match-card">
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.sf?.[mi]?.[ti]}
                {@const canClick = !data.isLocked && tid !== null}
                <button
                  class="team-btn"
                  class:picked={isPicked}
                  class:eliminated={explicitPicks.sf?.[mi]?.[1 - ti] && !isPicked && tid !== null}
                  disabled={!canClick}
                  onclick={() => canClick && pickTeam('sf', mi, ti, tid)}
                >
                  {#if t}
                    <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                    <span class="team-name">{shortName(t.name)}</span>
                    {#if isPicked}<span class="pick-star">★</span>{/if}
                  {:else}
                    <span class="team-empty">—</span>
                  {/if}
                </button>
              {/each}
              <div class="match-label">SF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Final + 3rd -->
      <div class="bracket-col">
        <div class="col-header">Final</div>
        <div class="match-list final-list">
          <!-- Final match -->
          <div class="match-card match-final">
            {#each [0, 1] as ti}
              {@const tid = teams.final?.[0]?.[ti]}
              {@const t = teamMap[tid]}
              {@const isPicked = explicitPicks.final?.[0]?.[ti]}
              {@const canClick = !data.isLocked && tid !== null}
              <button
                class="team-btn"
                class:picked={isPicked}
                class:eliminated={explicitPicks.final?.[0]?.[1 - ti] && !isPicked && tid !== null}
                disabled={!canClick}
                onclick={() => canClick && pickTeam('final', 0, ti, tid)}
              >
                {#if t}
                  <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                  <span class="team-name">{shortName(t.name)}</span>
                  {#if isPicked}<span class="pick-star">★</span>{/if}
                {:else}
                  <span class="team-empty">—</span>
                {/if}
              </button>
            {/each}
            <div class="match-label match-label-final">🏆 FINAL</div>
          </div>

          <!-- 3rd place -->
          <div class="match-card match-3rd">
            <div class="match-label-3rd">3rd Place</div>
            {#each [0, 1] as ti}
              {@const tid = teams['3rd']?.[0]?.[ti]}
              {@const t = teamMap[tid]}
              {@const isPicked = explicitPicks['3rd']?.[0]?.[ti]}
              {@const canClick = !data.isLocked && tid !== null}
              <button
                class="team-btn"
                class:picked={isPicked}
                class:eliminated={explicitPicks['3rd']?.[0]?.[1 - ti] && !isPicked && tid !== null}
                disabled={!canClick}
                onclick={() => canClick && pickTeam('3rd', 0, ti, tid)}
              >
                {#if t}
                  <span class="team-flag">{flagEmoji(t.flag_code)}</span>
                  <span class="team-name">{shortName(t.name)}</span>
                  {#if isPicked}<span class="pick-star">★</span>{/if}
                {:else}
                  <span class="team-empty">—</span>
                {/if}
              </button>
            {/each}
            <div class="match-label">3RD</div>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- Legend -->
  <div class="bracket-legend">
    <span class="legend-item"><span class="pick-star">★</span> Your pick</span>
    <span class="legend-item"><span class="legend-match">A1 vs B2</span> Group matchup</span>
    <span class="legend-item"><span class="legend-tbd">TBD</span> 3rd place qualifiers</span>
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
  }

  /* Match lists with proper spacing between rounds */
  .match-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 140px;
  }

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
      padding: 5px 6px;
      font-size: 10px;
      gap: 3px;
    }

    .team-flag { font-size: 11px; }
    .team-name { font-size: 10px; }

    .bracket-title { font-size: 16px; }
    .col-header { font-size: 9px; padding: 4px 8px; }
  }
</style>