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

  $effect(() => {
    const t = {};
    const exp = {};

    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      let team1 = null, team2 = null;
      if (m.t1g !== '?') {
        const gp = data.groupPredictions?.[m.t1g];
        team1 = gp ? [gp.pos1, gp.pos2, gp.pos3, gp.pos4][m.t1p - 1] : null;
      }
      if (m.t2g !== '?') {
        const gp = data.groupPredictions?.[m.t2g];
        team2 = gp ? [gp.pos1, gp.pos2, gp.pos3, gp.pos4][m.t2p - 1] : null;
      }
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
    for (let i = 0; i < 32; i++) {
      const slot = i + 1;
      const mi = Math.floor(i / 2);
      const ti = i % 2;
      if (data.existingBracket?.r32?.[slot]) {
        t.r32[mi][ti] = data.existingBracket.r32[slot];
        exp.r32[mi][ti] = true;
      }
    }

    t.r16 = []; exp.r16 = [];
    for (let i = 0; i < 8; i++) { t.r16.push([null, null]); exp.r16.push([false, false]); }
    for (let i = 0; i < 16; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.r16?.[slot]) { t.r16[mi][ti] = data.existingBracket.r16[slot]; exp.r16[mi][ti] = true; }
    }

    t.qf = []; exp.qf = [];
    for (let i = 0; i < 4; i++) { t.qf.push([null, null]); exp.qf.push([false, false]); }
    for (let i = 0; i < 8; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.qf?.[slot]) { t.qf[mi][ti] = data.existingBracket.qf[slot]; exp.qf[mi][ti] = true; }
    }

    t.sf = []; exp.sf = [];
    for (let i = 0; i < 2; i++) { t.sf.push([null, null]); exp.sf.push([false, false]); }
    for (let i = 0; i < 4; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.sf?.[slot]) { t.sf[mi][ti] = data.existingBracket.sf[slot]; exp.sf[mi][ti] = true; }
    }

    t.final = [[null, null]]; exp.final = [[false, false]];
    for (let i = 0; i < 2; i++) {
      if (data.existingBracket?.final?.[i + 1]) { t.final[0][i] = data.existingBracket.final[i + 1]; exp.final[0][i] = true; }
    }

    t['3rd'] = [[null, null]]; exp['3rd'] = [[false, false]];
    for (let i = 0; i < 2; i++) {
      if (data.existingBracket?.['3rd']?.[i + 1]) { t['3rd'][0][i] = data.existingBracket['3rd'][i + 1]; exp['3rd'][0][i] = true; }
    }

    teams = t;
    explicitPicks = exp;
    cascadeAll();
  });

  function cascadeAll() {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        if (!explicitPicks.r16[i][j]) teams.r16[i][j] = getWinner('r32', i * 2 + j);
      }
    }
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        if (!explicitPicks.qf[i][j]) teams.qf[i][j] = getWinner('r16', i * 2 + j);
      }
    }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        if (!explicitPicks.sf[i][j]) teams.sf[i][j] = getWinner('qf', i * 2 + j);
      }
    }
    for (let j = 0; j < 2; j++) {
      if (!explicitPicks.final[0][j]) teams.final[0][j] = getWinner('sf', j);
    }
  }

  function getWinner(phase, matchIdx) {
    const m = teams[phase]?.[matchIdx];
    if (!m) return null;
    const [a, b] = m;
    if (a && b) return null;
    return a || b;
  }

  function pickTeam(phase, matchIdx, teamIdx, teamId) {
    const cur = teams[phase][matchIdx][teamIdx];
    if (cur === teamId) {
      teams[phase][matchIdx][teamIdx] = null;
      explicitPicks[phase][matchIdx][teamIdx] = false;
    } else {
      teams[phase][matchIdx][teamIdx] = teamId;
      explicitPicks[phase][matchIdx][teamIdx] = true;
      teams[phase][matchIdx][1 - teamIdx] = null;
      explicitPicks[phase][matchIdx][1 - teamIdx] = false;
    }
    cascadeAll();
  }

  async function saveBracket() {
    saving = true; saved = false;
    try {
      const picks = {};
      for (const phase of PHASES) {
        picks[phase] = {};
        const pt = teams[phase];
        if (!pt) continue;
        for (let i = 0; i < pt.length; i++) {
          for (let j = 0; j < 2; j++) {
            const slot = i * 2 + j + 1;
            const tid = pt[i][j];
            picks[phase][slot] = tid; // always send, even null (server handles deletion)
          }
        }
      }
      const res = await fetch('/api/predictions/bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.predictionId, picks }),
      });
      if (res.ok) { saved = true; setTimeout(() => { saved = false; }, 2500); }
      else { saveError = 'Save failed'; setTimeout(() => { saveError = null; }, 3000); }
    } catch (e) { console.error(e); }
    finally { saving = false; }
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
      'Ivory Coast': 'Ivory Coast', 'New Zealand': 'N. Zealand', 'Cape Verde': 'Cape Verde',
      'Czech Republic': 'Czechia', 'Saudi Arabia': 'S. Arabia',
      'Bosnia and Herzegovina': 'Bosnia', 'DR Congo': 'DR Congo', 'North Macedonia': 'N. Macedonia',
    };
    return map[name] || (name ? name.substring(0, 12) : '');
  }

  function r32Label(mi) {
    const m = R32_MAP[mi];
    if (m.t1g === '?') return `R32-${mi + 1}`;
    return `${m.t1g}${m.t1p} vs ${m.t2g}${m.t2p}`;
  }

  const totalPicks = $derived.by(() => {
    let n = 0;
    for (const phase of PHASES) {
      const pt = teams[phase];
      if (!pt) continue;
      for (const m of pt) { if (m[0] !== null) n++; if (m[1] !== null) n++; }
    }
    return n;
  });
</script>

<div>
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Back to pool
  </a>

  <div style="margin-bottom: 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
    <div>
      <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Knockout Bracket</h1>
      <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
        Click a team to advance them. Picks cascade from group predictions.
      </p>
    </div>
    {#if data.isLocked}
      <div style="padding: 8px 12px; background: rgba(255,77,106,0.1); border: 1px solid var(--red); border-radius: 6px; font-size: 10px; color: var(--red); white-space: nowrap;">
        ⚠️ Locked
      </div>
    {:else}
      <div style="display: flex; gap: 12px; align-items: center;">
        <span style="font-size: 10px; color: var(--text-dim);">{totalPicks} slots filled</span>
        <button class="btn-primary" disabled={saving} onclick={saveBracket}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Bracket'}
        </button>
      </div>
    {/if}
  </div>

  <div style="overflow-x: auto; padding-bottom: 16px;">
    <div style="display: flex; gap: 0; min-width: 1100px; align-items: flex-start;">

      <!-- R32 column -->
      <div style="flex: 0 0 auto; padding-right: 4px;">
        <div style="text-align: center; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 4px; padding: 4px 6px; min-width: 80px;">Round of 32</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          {#each (teams.r32 || []) as match, mi}
            {@const m = R32_MAP[mi]}
            {@const isPlaceholder = m.t1g === '?'}
            <div style="background: var(--bg-card); border: 1px solid {isPlaceholder ? 'rgba(100,100,100,0.2)' : 'var(--border)'}; border-radius: 4px; overflow: hidden; min-width: 80px; opacity: {isPlaceholder ? 0.5 : 1};">
              <div style="display: flex; flex-direction: column; gap: 0;">
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const canClick = !data.isLocked && !isPlaceholder && tid !== null}
                  <button
                    disabled={!canClick}
                    onclick={() => canClick && pickTeam('r32', mi, ti, tid)}
                    style="display: flex; align-items: center; gap: 3px; padding: 4px 6px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid var(--border)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--text)' : 'var(--text-dim)'}; font-size: 10px; font-family: inherit; transition: background 0.1s;"
                    onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.15)')}
                    onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{mi * 2 + ti + 1}</span>
                    {#if t}
                      <span>{flagEmoji(t.flag_code)}</span>
                      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(t.name)}</span>
                      {#if explicitPicks.r32?.[mi]?.[ti]}<span style="color: var(--gold); font-size: 8px;">★</span>{/if}
                    {:else if isPlaceholder}
                      <span style="color: var(--text-dim); font-style: italic; font-size: 9px;">TBD</span>
                    {:else}
                      <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 9px;">—</span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div style="text-align: center; font-size: 8px; color: var(--text-dim); padding: 1px 4px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2);">{r32Label(mi)}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- R32→R16 connector -->
      <div style="display: flex; flex-direction: column; justify-content: space-around; padding: 22px 2px; gap: 0; flex: 0 0 auto;">
        {#each Array(8) as _, i}
          <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: {i < 4 ? (i === 0 ? '0' : '6px 0') : (i === 4 ? '6px 0' : '6px 0')};"></div>
        {/each}
      </div>

      <!-- R16 column -->
      <div style="flex: 0 0 auto; padding: 0 4px;">
        <div style="text-align: center; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 4px; padding: 4px 6px; min-width: 80px;">Round of 16</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          {#each (teams.r16 || []) as match, mi}
            <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; min-width: 80px; margin-top: {mi > 0 ? (mi === 4 ? '0' : '9px') : '0'};">
              <div style="display: flex; flex-direction: column; gap: 0;">
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button
                    disabled={!canClick}
                    onclick={() => canClick && pickTeam('r16', mi, ti, tid)}
                    style="display: flex; align-items: center; gap: 3px; padding: 4px 6px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid var(--border)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--text)' : 'var(--text-dim)'}; font-size: 10px; font-family: inherit; transition: background 0.1s;"
                    onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.15)')}
                    onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{mi * 2 + ti + 1}</span>
                    {#if t}
                      <span>{flagEmoji(t.flag_code)}</span>
                      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(t.name)}</span>
                      {#if explicitPicks.r16?.[mi]?.[ti]}<span style="color: var(--gold); font-size: 8px;">★</span>{/if}
                    {:else}
                      <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 9px;">—</span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div style="text-align: center; font-size: 8px; color: var(--text-dim); padding: 1px 4px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2);">R16-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- R16→QF connector -->
      <div style="display: flex; flex-direction: column; justify-content: space-around; padding: 22px 2px; gap: 0; flex: 0 0 auto;">
        {#each Array(4) as _, i}
          <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: {i % 2 === 0 ? '0' : '14px 0'};"></div>
        {/each}
      </div>

      <!-- QF column -->
      <div style="flex: 0 0 auto; padding: 0 4px;">
        <div style="text-align: center; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 4px; padding: 4px 6px; min-width: 80px;">Quarterfinals</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          {#each (teams.qf || []) as match, mi}
            <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; min-width: 80px; margin-top: {mi > 0 ? '21px' : '0'};">
              <div style="display: flex; flex-direction: column; gap: 0;">
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button
                    disabled={!canClick}
                    onclick={() => canClick && pickTeam('qf', mi, ti, tid)}
                    style="display: flex; align-items: center; gap: 3px; padding: 4px 6px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid var(--border)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--text)' : 'var(--text-dim)'}; font-size: 10px; font-family: inherit; transition: background 0.1s;"
                    onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.15)')}
                    onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{mi * 2 + ti + 1}</span>
                    {#if t}
                      <span>{flagEmoji(t.flag_code)}</span>
                      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(t.name)}</span>
                      {#if explicitPicks.qf?.[mi]?.[ti]}<span style="color: var(--gold); font-size: 8px;">★</span>{/if}
                    {:else}
                      <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 9px;">—</span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div style="text-align: center; font-size: 8px; color: var(--text-dim); padding: 1px 4px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2);">QF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- QF→SF connector -->
      <div style="display: flex; flex-direction: column; justify-content: space-around; padding: 22px 2px; gap: 0; flex: 0 0 auto;">
        <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: 0;"></div>
        <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: 46px 0;"></div>
        <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: 46px 0;"></div>
        <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2); margin: 0;"></div>
      </div>

      <!-- SF column -->
      <div style="flex: 0 0 auto; padding: 0 4px;">
        <div style="text-align: center; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 4px; padding: 4px 6px; min-width: 80px;">Semifinals</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          {#each (teams.sf || []) as match, mi}
            <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; min-width: 80px; margin-top: {mi > 0 ? '85px' : '0'};">
              <div style="display: flex; flex-direction: column; gap: 0;">
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button
                    disabled={!canClick}
                    onclick={() => canClick && pickTeam('sf', mi, ti, tid)}
                    style="display: flex; align-items: center; gap: 3px; padding: 4px 6px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid var(--border)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--text)' : 'var(--text-dim)'}; font-size: 10px; font-family: inherit; transition: background 0.1s;"
                    onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.15)')}
                    onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{mi * 2 + ti + 1}</span>
                    {#if t}
                      <span>{flagEmoji(t.flag_code)}</span>
                      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(t.name)}</span>
                      {#if explicitPicks.sf?.[mi]?.[ti]}<span style="color: var(--gold); font-size: 8px;">★</span>{/if}
                    {:else}
                      <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 9px;">—</span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div style="text-align: center; font-size: 8px; color: var(--text-dim); padding: 1px 4px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2);">SF-{mi + 1}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- SF→Final connector -->
      <div style="display: flex; flex-direction: column; justify-content: center; padding: 22px 2px; gap: 0; flex: 0 0 auto;">
        <div style="width: 14px; height: 4px; background: rgba(201,168,76,0.2);"></div>
      </div>

      <!-- Final + 3rd column -->
      <div style="flex: 0 0 auto; padding: 0 4px;">
        <div style="text-align: center; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 4px; padding: 4px 6px; min-width: 100px;">Final</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          <!-- Final -->
          <div style="background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.3); border-radius: 4px; overflow: hidden; min-width: 100px;">
            <div style="display: flex; flex-direction: column; gap: 0;">
              {#each [0, 1] as ti}
                {@const tid = teams.final?.[0]?.[ti]}
                {@const t = teamMap[tid]}
                {@const canClick = !data.isLocked && tid !== null}
                <button
                  disabled={!canClick}
                  onclick={() => canClick && pickTeam('final', 0, ti, tid)}
                  style="display: flex; align-items: center; gap: 4px; padding: 5px 8px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid rgba(201,168,76,0.3)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--gold-light)' : 'var(--text-dim)'}; font-size: 11px; font-family: inherit; transition: background 0.1s;"
                  onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.2)')}
                  onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{ti + 1}</span>
                  {#if t}
                    <span style="font-size: 13px;">{flagEmoji(t.flag_code)}</span>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">{shortName(t.name)}</span>
                    {#if explicitPicks.final?.[0]?.[ti]}<span style="color: var(--gold); font-size: 8px;">★</span>{/if}
                  {:else}
                    <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 10px;">—</span>
                  {/if}
                </button>
              {/each}
            </div>
            <div style="text-align: center; font-size: 8px; color: var(--gold); padding: 2px 4px; border-top: 1px solid rgba(201,168,76,0.3); background: rgba(0,0,0,0.3); letter-spacing: 0.1em;">🏆 FINAL</div>
          </div>

          <!-- 3rd place -->
          <div style="margin-top: 16px;">
            <div style="text-align: center; font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px;">3rd Place</div>
            <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; min-width: 100px;">
              <div style="display: flex; flex-direction: column; gap: 0;">
                {#each [0, 1] as ti}
                  {@const tid = teams['3rd']?.[0]?.[ti]}
                  {@const t = teamMap[tid]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button
                    disabled={!canClick}
                    onclick={() => canClick && pickTeam('3rd', 0, ti, tid)}
                    style="display: flex; align-items: center; gap: 4px; padding: 5px 8px; background: transparent; border: none; border-top: {ti === 1 ? '1px solid var(--border)' : 'none'}; cursor: {canClick ? 'pointer' : 'default'}; text-align: left; width: 100%; color: {tid ? 'var(--text)' : 'var(--text-dim)'}; font-size: 11px; font-family: inherit; transition: background 0.1s;"
                    onmouseenter={(e) => canClick && (e.currentTarget.style.background = 'rgba(201,168,76,0.15)')}
                    onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style="color: var(--text-dim); font-size: 8px; width: 8px; flex-shrink: 0;">{ti +
1}</span>
                    {#if t}
                      <span style="font-size: 12px;">{flagEmoji(t.flag_code)}</span>
                      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{shortName(t.name)}</span>
                      {#if explicitPicks['3rd']?.[0]?.[ti]}<span style="color: var(--gold); font-size: 8px;">&starf;</span>{/if}
                    {:else}
                      <span style="flex: 1; color: var(--text-dim); font-style: italic; font-size: 10px;">&mdash;</span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div style="text-align: center; font-size: 8px; color: var(--text-dim); padding: 1px 4px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2);">3RD</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- Legend -->
  <div style="margin-top: 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
    <div style="display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--text-dim);">
      <span style="color: var(--gold);">&starf;</span> <span>Your pick</span>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--text-dim);">
      <span style="background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 3px; padding: 1px 5px; font-size: 8px; color: var(--gold);">A1 vs B2</span>
      <span>Group matchup label</span>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--text-dim);">
      <span style="opacity: 0.5; border: 1px solid rgba(100,100,100,0.2); border-radius: 3px; padding: 1px 5px; font-size: 8px; color: var(--text-dim);">TBD</span>
      <span>3rd place (TBD)</span>
    </div>
  </div>

</div>
