<script>
  import { untrack } from 'svelte';
  import { showToast } from '$lib/toast';
  import { haptic } from '$lib/haptic';
  import { headerTitle } from '$lib/stores/header';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import { goto } from '$app/navigation';
  import {
    WILDCARD, R32_MAP, R32_TO_R16, R32_LABELS, R16_LABELS, QF_LABELS,
    SF_LABELS, FINAL_LABEL, THIRD_LABEL, THIRD_GROUP_MAP,
  } from '$lib/bracket-2026.js';
  let { data } = $props();

  $effect(() => {
    headerTitle.set({ text: 'Mi Quiniela', emoji: '⚔️', showBack: true, poolName: data.pool?.name, poolEmoji: data.pool?.emoji || '⚔️' });
    return () => { headerTitle.set({ text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null }); };
  });

  // Bracket constants (WILDCARD, R32_MAP, R32_TO_R16, labels, THIRD_GROUP_MAP)
  // live in $lib/bracket-2026.ts — the single source of truth, locked by
  // bracket-2026.test.ts against the official 2026 knockout tree.

  function r32Label(mi) { return R32_LABELS[mi] || `R32-${mi + 1}`; }
  function r16Label(mi) { return R16_LABELS[mi] || `R16-${mi + 1}`; }
  function qfLabel(mi) { return QF_LABELS[mi] || `QF-${mi + 1}`; }
  function sfLabel(mi) { return SF_LABELS[mi] || `SF-${mi + 1}`; }

  // Return 3rd-place teams from the groups eligible to feed this wildcard slot.
  function get3rdOptions(mi) {
    const groups = THIRD_GROUP_MAP[mi];
    if (!groups) return [];
    // Teams already chosen as the 3rd-place team in OTHER wildcard slots.
    const alreadyPicked = new Set();
    for (let i = 0; i < 16; i++) {
      if (i === mi) continue;
      const picked = _teams.r32[i]?.[1];
      if (picked && R32_MAP[i].t2g === WILDCARD) alreadyPicked.add(picked);
    }
    const eligible = [];
    const seen = new Set();
    for (const g of groups) {
      const gp = data.groupPredictions?.[g];
      if (gp?.pos3) {
        const team = teamMap[gp.pos3];
        if (team && !seen.has(team.id)) {
          seen.add(team.id);
          eligible.push({ id: team.id, name: team.name, flag_code: team.flag_code, group: g, usedElsewhere: alreadyPicked.has(team.id) });
        }
      }
    }
    // Normally show the teams not yet used elsewhere. But if ALL eligible teams
    // are already taken by other wildcard slots (a combinatorial dead-end), show
    // them anyway so the slot is never stuck — picking one MOVES it here
    // (pick3rd clears it from the other slot), keeping the 3rds distinct.
    const free = eligible.filter((o) => !o.usedElsewhere);
    return free.length > 0 ? free : eligible;
  }

  // State for the 3rd-place team selector modal
  let thirdSelectorOpen = $state(null);
  function openThirdSelector(mi) { haptic(8); thirdSelectorOpen = mi; }
  function closeThirdSelector() { thirdSelectorOpen = null; }
  // §3.13 — Track which 3rd-place team OCCUPIES slot 1 of a wildcard R32 match
  // independently from who WINS that match. Without this split, choosing the
  // 3rd-place team would also auto-promote them as the match winner.
  let _thirdSlots = {}; // { [mi]: teamId } — wildcard occupant only

  function pick3rd(mi, teamId) {
    haptic(8);
    animatePick('r32', mi, 1);
    const currentSlot = _thirdSlots[mi] ?? null;
    if (currentSlot === teamId) {
      // Undo slot selection — and any winner pick that referenced it.
      _thirdSlots[mi] = null;
      _teams.r32[mi][1] = null;
      // If the user had picked the 3rd team as the winner, clear that too.
      if (_picks.r32[mi]?.[1]) {
        _picks.r32[mi][1] = false;
      }
    } else {
      // Keep 3rd-place teams distinct: if this team already occupies another
      // wildcard slot, move it here by clearing it there (prevents a duplicate
      // and lets the user reassign out of a dead-end).
      for (let i = 0; i < 16; i++) {
        if (i !== mi && R32_MAP[i].t2g === WILDCARD && _thirdSlots[i] === teamId) {
          _thirdSlots[i] = null;
          _teams.r32[i][1] = null;
          if (_picks.r32[i]?.[1]) _picks.r32[i][1] = false;
        }
      }
      _thirdSlots[mi] = teamId;
      _teams.r32[mi][1] = teamId;
      // Setting the occupant does NOT mark them as the winner.
      _picks.r32[mi][1] = false;
    }
    recascade();
    bump();
    autoSaveBracket();
    closeThirdSelector();
  }

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
    // B5-4: Sin relleno automático — devolver null para que el hueco aparezca como TBD
    // y no confundir al usuario con equipos aleatorios.
    return null;
  }

  // Count how many groups have ALL 4 positions filled
  const groupsPredicted = $derived.by(() => {
    const groups = 'ABCDEFGHIJKL'.split('');
    return groups.filter(g => {
      const gp = data.groupPredictions?.[g];
      return gp?.pos1 && gp?.pos2 && gp?.pos3 && gp?.pos4;
    }).length;
  });

  // Initialize state from server data
  function initState() {
    const t = {};
    const exp = {};
    // §5.1 — Reset wildcard occupants before rebuilding state. Without this,
    // soft-switching to a different entry leaves the previous entry's
    // 3rd-place picks visible in the third-place selector modal.
    _thirdSlots = {};

    t.r32 = [];
    exp.r32 = [];
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      const team1 = m.t1g !== WILDCARD ? getGroupTeam(m.t1g, m.t1p) : null;
      const team2 = m.t2g !== WILDCARD ? getGroupTeam(m.t2g, m.t2p) : null;
      t.r32.push([team1, team2]);
      exp.r32.push([false, false]);
    }
    // Restore R32 per MATCH so wildcard 3rd-place slots can be read correctly.
    // For a wildcard match "1D vs 3rd": slot 1 is the user-picked 3rd-place
    // OCCUPANT, now persisted regardless of who wins; slot 0 (the direct team)
    // is stored only when it's the winner. So: the direct team won iff its slot
    // is present; otherwise the 3rd-place team is the advancer. For normal
    // matches a stored slot is simply the winner.
    for (let mi = 0; mi < 16; mi++) {
      const s0 = data.existingBracket?.r32?.[mi * 2 + 1] ?? null;
      const s1 = data.existingBracket?.r32?.[mi * 2 + 2] ?? null;
      if (R32_MAP[mi].t2g === WILDCARD) {
        if (s1 != null) {
          t.r32[mi][1] = s1;
          _thirdSlots[mi] = s1; // the chosen 3rd-place team occupies this slot
        }
        if (s0 != null) {
          t.r32[mi][0] = s0;
          exp.r32[mi][0] = true;   // the direct team advanced
        } else if (s1 != null) {
          exp.r32[mi][1] = true;   // the 3rd-place team advanced
        }
      } else {
        if (s0 != null) { t.r32[mi][0] = s0; exp.r32[mi][0] = true; }
        if (s1 != null) { t.r32[mi][1] = s1; exp.r32[mi][1] = true; }
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
  const teams = $derived.by(() => {
    void version;
    const t = {};
    for (const [k, v] of Object.entries(_teams)) {
      if (Array.isArray(v)) {
        t[k] = v.map(m => Array.isArray(m) ? [m[0], m[1]] : m);
      } else {
        t[k] = v;
      }
    }
    return t;
  });
  const explicitPicks = $derived.by(() => {
    void version;
    const p = {};
    for (const [k, v] of Object.entries(_picks)) {
      if (Array.isArray(v)) {
        p[k] = v.map(row => Array.isArray(row) ? [row[0], row[1]] : row);
      } else {
        p[k] = v;
      }
    }
    return p;
  });

  // (Re)initialize when the selected ENTRY changes — including first mount. Only
  // data.selectedId is a dependency (initState's data reads happen under untrack),
  // so a same-entry soft invalidate won't clobber in-progress picks, but switching
  // to a different/new entry rebuilds state from THAT entry instead of bleeding the
  // previous one's bracket into it.
  let _lastBracketEntryId = undefined;
  $effect(() => {
    const sel = data.selectedId;
    untrack(() => {
      if (sel === _lastBracketEntryId) return;
      _lastBracketEntryId = sel;
      initState();
      bump();
      // If initState's recascade had to drop a now-invalid 3rd-place pick (e.g. the
      // group was reordered after the bracket was filled), persist the corrected
      // bracket right away so the stale DB row can't keep blocking later saves.
      if (_cascadeClearedThisTick && sel && !data.isLocked) {
        autoSaveBracket();
      }
    });
  });

  let _cascadeClearedThisTick = false;
  function recascade() {
    _cascadeClearedThisTick = false;
    // Restore R32 from group predictions
    for (let i = 0; i < 16; i++) {
      const m = R32_MAP[i];
      if (m.t1g === WILDCARD) continue;
      _teams.r32[i][0] = getGroupTeam(m.t1g, m.t1p);

      if (m.t2g === WILDCARD) {
        // Wildcard 3rd-place slot. A group reorder can change who finishes 3rd —
        // or promote the chosen team to 1st/2nd, where it becomes a DIRECT
        // qualifier in another R32 slot. If the saved 3rd-place pick is no longer
        // a valid 3rd of an eligible group, DROP it: otherwise it lingers as a
        // stale pick that collides (same team in two R32 slots) and the save is
        // rejected with "Equipo repetido en fase r32".
        const cur = _thirdSlots[i] ?? null;
        const eligible = THIRD_GROUP_MAP[i] || [];
        const haveStandings = eligible.some(g => data.groupPredictions?.[g]?.pos3 != null);
        const stillValid = cur != null && eligible.some(g => data.groupPredictions?.[g]?.pos3 === cur);
        if (cur != null && haveStandings && !stillValid) {
          _thirdSlots[i] = null;
          _teams.r32[i][1] = null;
          _picks.r32[i][1] = false;
          if (!_cascadeClearedThisTick) {
            _cascadeClearedThisTick = true;
            showToast('ℹ️ Un 3.º cambió al reordenar el grupo — vuelve a elegirlo en el cuadro');
          }
        } else if (!_picks.r32[i][1]) {
          _teams.r32[i][1] = cur;
        }
      } else if (!_picks.r32[i][1]) {
        _teams.r32[i][1] = getGroupTeam(m.t2g, m.t2p);
      }
    }

    // Cascade: R32 → R16 uses special feed-in mapping
    for (let i = 0; i < _teams.r16.length; i++) {
      for (let j = 0; j < 2; j++) {
        const winner = getWinner('r32', R32_TO_R16[i * 2 + j]);
        // §5.2 — Invalidate explicit pick if the upstream winner changed.
        // Surface the clearing via a toast so users notice their later-phase
        // pick was wiped by an earlier-phase edit.
        if (_picks.r16[i][j] && _teams.r16[i][j] !== winner) {
          if (!_cascadeClearedThisTick) {
            _cascadeClearedThisTick = true;
            showToast('ℹ️ Picks de fases posteriores se han recalculado');
          }
          _picks.r16[i][0] = false;
          _picks.r16[i][1] = false;
        }
        _teams.r16[i][j] = _picks.r16[i][j] ? _teams.r16[i][j] : winner;
      }
    }
    // Cascade: R16 → QF uses an explicit FIFA-correct mapping;
    // QF → SF and SF → Final remain sequential pair-of-two.
    const R16_TO_QF = [0, 1, 2, 3, 4, 5, 6, 7]; // Sequential — bracket halves are correct
    for (let i = 0; i < _teams.qf.length; i++) {
      for (let j = 0; j < 2; j++) {
        const winner = getWinner('r16', R16_TO_QF[i * 2 + j]);
        if (_picks.qf[i][j] && _teams.qf[i][j] !== winner) {
          _picks.qf[i][0] = false;
          _picks.qf[i][1] = false;
        }
        _teams.qf[i][j] = _picks.qf[i][j] ? _teams.qf[i][j] : winner;
      }
    }
    // §5.4 — Make the QF→SF and SF→Final mappings explicit. They are
    // intentionally sequential pair-of-two (mirroring the FIFA bracket)
    // but the intent should not be buried inside `i*2+j`.
    const QF_TO_SF = [0, 1, 2, 3]; // SF[i] = (QF[i*2], QF[i*2+1])
    const SF_TO_FINAL = [0, 1];    // Final[0] = (SF[0], SF[1])
    const cascades = [
      { from: 'qf', to: 'sf', map: QF_TO_SF },
      { from: 'sf', to: 'final', map: SF_TO_FINAL },
    ];
    for (const { from, to, map } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          const winner = getWinner(from, map[i * 2 + j]);
          if (_picks[to][i][j] && _teams[to][i][j] !== winner) {
            _picks[to][i][0] = false;
            _picks[to][i][1] = false;
          }
          _teams[to][i][j] = _picks[to][i][j] ? _teams[to][i][j] : winner;
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
    // §4.2 — Cancel any prior animation for this button so rapid taps don't
    // overwrite origBg and leave the inline override stuck.
    const prev = btn.dataset.animTimer;
    if (prev) clearTimeout(Number(prev));
    if (!btn.dataset.origBg) btn.dataset.origBg = btn.style.background || '';
    btn.classList.add('team-pick');
    btn.style.background = 'rgba(201,168,76,0.15)';
    const tid = setTimeout(() => {
      btn.classList.remove('team-pick');
      btn.style.background = btn.dataset.origBg || '';
      delete btn.dataset.origBg;
      delete btn.dataset.animTimer;
    }, 200);
    btn.dataset.animTimer = String(tid);
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
  // The predicted final score is compared LOCAL-vs-LOCAL (the closeness metric
  // is orientation-sensitive), so players need to know which of their two
  // picked finalists counts as Local and which as Visitante. The final's home
  // side is slot 0 (the SF[0] winner), the away side slot 1 — the same teams
  // shown in the Final card above.
  const tieHomeTeam = $derived(teamMap[teams.final?.[0]?.[0]] ?? null);
  const tieAwayTeam = $derived(teamMap[teams.final?.[0]?.[1]] ?? null);
  let tieSaving = $state(false);
  let tieSaved = $state(false);


  let tieTimer = null;
  function onTieInput() {
    if (tieTimer) clearTimeout(tieTimer);
    tieTimer = setTimeout(saveTiebreaker, 800);
  }

  async function saveTiebreaker() {
    if (!data.selectedId) return;
    const h = tieHome !== null && tieHome !== '' ? Number(tieHome) : null;
    const a = tieAway !== null && tieAway !== '' ? Number(tieAway) : null;
    // §3.9 — Allow saving when both are null (treat as explicit clear); the
    // server will delete the row in that case. Previously this early-returned
    // and left a stale value in the DB.
    if ((h !== null && (isNaN(h) || h === null)) ||
        (a !== null && (isNaN(a) || a === null))) return;
    tieSaving = true; tieSaved = false;
    try {
      const r = await fetch('/api/predictions/tiebreaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, home_score: h, away_score: a }),
      });
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.action === 'deleted') showToast('✓ Borrado');
        else { showToast('✓ Guardado'); tieSaved = true; setTimeout(() => tieSaved = false, 2000); }
      }
    } catch {}
    tieSaving = false;
  }

  // Load tiebreaker on mount
  $effect(() => {
    const id = data.selectedId;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/predictions/tiebreaker?prediction_id=${id}`);
        if (!cancelled && r.ok) {
          const d = await r.json();
          tieHome = d.home_score;
          tieAway = d.away_score;
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  });

  // Cleanup timers on component destroy
  $effect(() => {
    return () => {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (tieTimer) clearTimeout(tieTimer);
    };
  });

  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state(null);
  let showCreateEntry = $state(false);
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');
  let copyFromId = $state(''); // seed a NEW entry from an existing one
  let copyOntoSourceId = $state(''); // copy another entry onto the current one
  let copying = $state(false);
  let copyMsg = $state('');

  // Team path highlighting
  let hoveredTeam = $state(null); // team ID being hovered (desktop)
  let pinnedTeam  = $state(null); // team ID locked by tap (mobile)
  const activeTeam = $derived(pinnedTeam ?? hoveredTeam);

  function getTeamPath(teamId, teamsSnapshot) {
    // Trace a team's path through the bracket
    const path = new Set(); // set of 'round:matchIndex:teamIndex' keys
    if (!teamId) return path;

    // Find where this team appears in each round
    for (const round of ['r32', 'r16', 'qf', 'sf']) {
      const matches = teamsSnapshot[round] || [];
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
    if (teamsSnapshot.final?.[0]) {
      for (let ti = 0; ti < 2; ti++) {
        if (Number(teamsSnapshot.final[0][ti]) === Number(teamId)) {
          path.add(`final:0:${ti}`);
          path.add(`final:0`);
        }
      }
    }
    return path;
  }

  const teamPath = $derived(getTeamPath(activeTeam, teams));

  function isInPath(round, mi, ti = null) {
    if (!activeTeam) return false;
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
            // A wildcard R32 slot-1 holds the user's chosen 3rd-place team — a
            // prediction in itself. Persist it even when it's not the match
            // winner, otherwise picking a 3rd team without advancing it is lost
            // on reload.
            if (phase === 'r32' && j === 1 && R32_MAP[i].t2g === WILDCARD && _thirdSlots[i] != null) {
              picks[phase][slot] = _thirdSlots[i];
            } else {
              picks[phase][slot] = exp[j] ? pt[i][j] : null;
            }
          }
        }
      }
      const res = await fetch('/api/predictions/bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, picks }),
      });
      if (res.ok) { saveError = null; showToast('✓ Guardado'); }
      else {
        const body = await res.json().catch(() => ({}));
        saveError = body.error || 'Error al guardar';
        showToast('⚠️ ' + saveError);
        setTimeout(() => { saveError = null; }, 3000);
      }
    } catch (e) {
      console.error(e);
      saveError = 'Error de conexión';
      showToast('⚠️ ' + saveError);
      setTimeout(() => { saveError = null; }, 3000);
    }
    finally { saving = false; }
  }

  async function switchEntry(label) {
    // §4.2 — Flush any pending autosave before switching so the last edit
    // isn't lost. Use goto for soft navigation; window.location.href would
    // also discard the carefully-built _teams/_picks state.
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
      await saveBracket();
    }
    const url = new URL(window.location.href);
    if (label) url.searchParams.set('entry', label);
    else url.searchParams.delete('entry');
    await goto(url.pathname + url.search, { invalidateAll: true });
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
        // Optionally seed the new entry from an existing one (copies group +
        // knockout + tiebreaker server-side).
        if (copyFromId) {
          const cr = await fetch('/api/predictions/entry/copy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: Number(copyFromId), target_id: d.id }),
          });
          if (!cr.ok) { createMsg = (await cr.json()).error || 'No se pudo copiar'; creating = false; return; }
        }
        showCreateEntry = false;
        newEntryLabel = ''; copyFromId = '';
        // §4.2 — Use goto for soft navigation; preserves any pending state.
        await goto(`/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`, { invalidateAll: true });
      } else {
        createMsg = d.error || 'Error';
      }
    } catch { createMsg = 'Error de conexión'; }
    creating = false;
  }

  // Copy another entry's picks ONTO the currently-selected entry (overwrites it).
  async function copyEntryOnto() {
    if (!copyOntoSourceId || !data.selectedId) return;
    const src = data.entries.find(e => e.id === Number(copyOntoSourceId));
    const tgtLabel = data.selectedLabel || 'Entrada principal';
    if (!confirm(`Esto reemplazará TODOS los pronósticos de «${tgtLabel}» con una copia de «${src?.label}». ¿Continuar?`)) return;
    copying = true; copyMsg = '';
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; await saveBracket(); }
    try {
      const r = await fetch('/api/predictions/entry/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(copyOntoSourceId), target_id: data.selectedId }),
      });
      const d = await r.json();
      if (r.ok) {
        copyOntoSourceId = '';
        const url = new URL(window.location.href);
        await goto(url.pathname + url.search, { invalidateAll: true });
      } else { copyMsg = d.error || 'No se pudo copiar'; }
    } catch { copyMsg = 'Error de conexión'; }
    copying = false;
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
    {#if data.entries.length > 1 || (data.pool.allow_multiple_predictions)}
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
        {#if data.pool.allow_multiple_predictions}
          <button onclick={() => { showCreateEntry = true; newEntryLabel = ''; createMsg = ''; }}
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
        {#if saveError}
          <span style="font-size: 10px; color: var(--red);">⚠️ {saveError}</span>
        {:else if saving}
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
  {#if data.pool.allow_multiple_predictions && showCreateEntry}
    <div style="margin-bottom: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--gold); border-radius: 8px;">
      <div style="display: flex; gap: 8px; align-items: flex-end;">
        <div style="flex: 1;">
          <input bind:value={newEntryLabel} placeholder="Nombre de la entrada..."
            style="width: 100%; font-size: 12px; padding: 8px 10px;"
            onkeydown={(e) => { if (e.key === 'Enter') createEntry(); }} />
        </div>
        <button onclick={createEntry} disabled={creating || !newEntryLabel.trim()} class="btn-primary" style="font-size: 9px; padding: 8px 16px; white-space: nowrap;">{creating ? '...' : 'Crear'}</button>
        <button onclick={() => { showCreateEntry = false; newEntryLabel = ''; copyFromId = ''; createMsg = ''; }} style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
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
          {#if copyFromId}<div style="margin-top: 4px; font-size: 9px; color: var(--text-dim);">Se copiarán todos los pronósticos (grupos, cuadro y final); luego puedes hacer cambios.</div>{/if}
        </div>
      {/if}
      {#if createMsg}<div style="margin-top: 8px; font-size: 10px; color: var(--red);">{createMsg}</div>{/if}
    </div>
  {/if}

  <!-- Copy another entry ONTO the current one (overwrite) -->
  {#if data.entries.length > 1 && !data.isLocked && data.selectedId}
    <div style="margin-bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
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

  <!-- Tiebreaker: predicted final score (kept at the TOP so nobody misses it) -->
  <div class="tiebreaker-card">
    <div class="tiebreaker-title">🏆 Resultado de la Final (desempate)</div>
    <div class="tiebreaker-subtitle">No te lo saltes: si hay empate a puntos, gana quien más se acerque al marcador real de la final. Puedes rellenarlo en cualquier momento.</div>
    {#if tieHomeTeam && tieAwayTeam}
      <div class="tiebreaker-hint">Según tu cuadro, el <b>local</b> es <b>{shortName(tieHomeTeam.name)}</b> y el <b>visitante</b> es <b>{shortName(tieAwayTeam.name)}</b>.</div>
    {:else}
      <div class="tiebreaker-hint">Elige a tus dos finalistas en el cuadro para ver quién es local y quién visitante.</div>
    {/if}
    <div class="tiebreaker-inputs">
      <div class="tiebreaker-team">
        <span style="font-size: 11px; color: var(--text-dim); margin-bottom: 2px;">Local</span>
        {#if tieHomeTeam}
          <span class="tiebreaker-teamname"><span class="team-flag">{@html flagEmoji(tieHomeTeam.flag_code)}</span> {shortName(tieHomeTeam.name)}</span>
        {:else}
          <span class="tiebreaker-teamname tiebreaker-teamname-empty">tu finalista</span>
        {/if}
        <input
          type="number"
          min="0"
          max="30"
          bind:value={tieHome}
          oninput={onTieInput}
          placeholder="-"
          disabled={data.isLocked}
          class="tiebreaker-input"
          aria-label={tieHomeTeam ? `Goles de ${shortName(tieHomeTeam.name)} (local)` : 'Goles del local'}
        />
      </div>
      <span class="tiebreaker-dash">—</span>
      <div class="tiebreaker-team">
        <span style="font-size: 11px; color: var(--text-dim); margin-bottom: 2px;">Visitante</span>
        {#if tieAwayTeam}
          <span class="tiebreaker-teamname"><span class="team-flag">{@html flagEmoji(tieAwayTeam.flag_code)}</span> {shortName(tieAwayTeam.name)}</span>
        {:else}
          <span class="tiebreaker-teamname tiebreaker-teamname-empty">tu finalista</span>
        {/if}
        <input
          type="number"
          min="0"
          max="30"
          bind:value={tieAway}
          oninput={onTieInput}
          placeholder="-"
          disabled={data.isLocked}
          class="tiebreaker-input"
          aria-label={tieAwayTeam ? `Goles de ${shortName(tieAwayTeam.name)} (visitante)` : 'Goles del visitante'}
        />
      </div>
    </div>
    <div style="margin-top: 6px; font-size: 10px;">
      {#if tieSaving}<span style="color: var(--text-muted);">Guardando...</span>
      {:else if tieSaved}<span style="color: var(--green);">✓ Guardado</span>
      {:else if tieHome !== null && tieAway !== null}<span style="color: var(--text-dim);">Auto-guardado</span>
      {:else}<span style="color: var(--text-dim);">Opcional pero recomendado</span>{/if}
    </div>
  </div>

  <!-- Warning: incomplete groups -->
  {#if groupsPredicted < 12}
    <div class="incomplete-banner">
      <span>⚠️ Grupos incompletos ({groupsPredicted}/12) — los cruces sin predicción de grupo aparecerán como TBD.</span>
      <a href="/pool/{data.pool.id}/predict" style="color: var(--gold); text-decoration: underline; font-size: 10px;">Rellenar grupos →</a>
    </div>
  {/if}

  <!-- 3rd-place team selector modal -->
  {#if thirdSelectorOpen !== null}
    {@const options = get3rdOptions(thirdSelectorOpen)}
    {@const pickedTeam = teams.r32?.[thirdSelectorOpen]?.[1]}
    {@const pickedTeamObj = pickedTeam ? teamMap[pickedTeam] : null}
    <div class="third-selector-overlay" onclick={closeThirdSelector}>
      <div class="third-selector-sheet" onclick={(e) => e.stopPropagation()}>
        <div class="third-selector-header">
          <span>¿Quién pasa como mejor 3º?</span>
          <button onclick={closeThirdSelector} style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;">✕</button>
        </div>
        <p class="third-selector-sub">Tus terceros de grupo en este cruce:</p>
        {#if options.length === 0}
          <div class="third-selector-empty">
            <span style="font-size:16px;">🤷</span>
            <span>No hay equipos disponibles para este cruce.</span>
            <span style="font-size:10px;color:var(--text-dim);margin-top:4px;">Predice los grupos primero para desbloquear los 3ros.</span>
            <a href="/pool/{data.pool.id}/predict" class="btn-primary" style="display:inline-block;margin-top:12px;font-size:11px;padding:8px 20px;">Predecir grupos →</a>
          </div>
        {:else}
          <div class="third-selector-grid">
            {#each options as opt}
              <button class="third-team-btn" class:selected={pickedTeam === opt.id} onclick={() => pick3rd(thirdSelectorOpen, opt.id)} title={opt.usedElsewhere ? 'Ya elegido en otro cruce — al elegirlo aquí se moverá' : ''}>
                <span class="team-flag">{@html flagEmoji(opt.flag_code)}</span>
                <span class="team-name">{shortName(opt.name)}</span>
                <span class="third-group-badge">3º {opt.group}</span>
                {#if opt.usedElsewhere}<span style="font-size:8px;color:var(--text-dim);">↔ otro cruce</span>{/if}
                {#if pickedTeam === opt.id}<span class="pick-star">★</span>{/if}
              </button>
            {/each}
          </div>
          <p class="third-selector-hint">Pulsa para elegir quién pasa. Vuelve a pulsar para deseleccionar.</p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Bracket Grid -->
  <div class="bracket-scroll" ontouchend={(e) => { if (!e.target.closest('.team-btn')) pinnedTeam = null; }}>
    <!-- Desktop: split bracket layout -->
    <div class="bracket-grid desktop-bracket">
      <!-- LEFT WING -->
      <div class="bracket-wing">
        <div class="bracket-col">
          <div class="col-header">Dieciseisavos</div>
          <div class="match-list r32-list">
            {#each (teams.r32 || []).slice(0, 8) as match, mi}
              {@const m = R32_MAP[mi]}
              {@const isPlaceholder = m.t1g === WILDCARD}
              <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                  {@const isThirdSlot = ti === 1 && m.t2g === WILDCARD}
                  {@const canClick = !data.isLocked && (tid !== null || isThirdSlot)}
                  <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => { if (!canClick) return; if (isThirdSlot && tid === null) { openThirdSelector(mi); } else { pickTeam('r32', mi, ti, tid); } }} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { if (tid) hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if isThirdSlot && !data.isLocked}<span class="third-change" role="button" tabindex="-1" title="Cambiar tercero" onclick={(e) => { e.stopPropagation(); openThirdSelector(mi); }}>▾</span>{/if}
                    {:else if isThirdSlot}
                      {@const options = get3rdOptions(mi)}
                      {#if options.length > 0}
                        <span class="team-tbd team-tbd-btn">3rd ▾</span>
                      {:else}
                        <span class="team-tbd">TBD</span>
                      {/if}
                    {:else if isPlaceholder}<span class="team-tbd">TBD</span>
                    {:else}<span class="team-empty">—</span>{/if}
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
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
              {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
              {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
              {@const isPlaceholder = m.t1g === WILDCARD}
              <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
                {#each [0, 1] as ti}
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                  {@const isThirdSlot = ti === 1 && m.t2g === WILDCARD}
                  {@const canClick = !data.isLocked && (tid !== null || isThirdSlot)}
                  <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => { if (!canClick) return; if (isThirdSlot && tid === null) { openThirdSelector(mi); } else { pickTeam('r32', mi, ti, tid); } }} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { if (tid) hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if isThirdSlot && !data.isLocked}<span class="third-change" role="button" tabindex="-1" title="Cambiar tercero" onclick={(e) => { e.stopPropagation(); openThirdSelector(mi); }}>▾</span>{/if}
                    {:else if isThirdSlot}
                      {@const options = get3rdOptions(mi)}
                      {#if options.length > 0}
                        <span class="team-tbd team-tbd-btn">3rd ▾</span>
                      {:else}
                        <span class="team-tbd">TBD</span>
                      {/if}
                    {:else if isPlaceholder}<span class="team-tbd">TBD</span>
                    {:else}<span class="team-empty">—</span>{/if}
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
            {@const isPlaceholder = m.t1g === WILDCARD}
            <div class="match-card" class:placeholder={isPlaceholder} class:path-highlight={isInPath('r32', mi)}>
              {#each [0, 1] as ti}
                {@const tid = match[ti]}
                {@const t = teamMap[tid]}
                {@const isPicked = explicitPicks.r32?.[mi]?.[ti]}
                {@const isThirdSlot = ti === 1 && m.t2g === WILDCARD}
                {@const canClick = !data.isLocked && (tid !== null || isThirdSlot)}
                <button id={"btn-r32-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r32?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r32', mi, ti)} disabled={!canClick} onclick={() => { if (!canClick) return; if (isThirdSlot && tid === null) { openThirdSelector(mi); } else { pickTeam('r32', mi, ti, tid); } }} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { if (tid) hoveredTeam = null; }}>
                  {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if isThirdSlot && !data.isLocked}<span class="third-change" role="button" tabindex="-1" title="Cambiar tercero" onclick={(e) => { e.stopPropagation(); openThirdSelector(mi); }}>▾</span>{/if}
                  {:else if isThirdSlot}
                    {@const options = get3rdOptions(mi)}
                    {#if options.length > 0}
                      <span class="team-tbd team-tbd-btn">3rd ▾</span>
                    {:else}
                      <span class="team-tbd">TBD</span>
                    {/if}
                  {:else if isPlaceholder}<span class="team-tbd">TBD</span>
                  {:else}<span class="team-empty">—</span>{/if}
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
                <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                  {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                  {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                  {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
                {#if t}<span class="team-flag">{@html flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
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
    <span class="legend-item"><span class="legend-tbd">TBD</span> Clasificados (3er puesto o grupo sin predecir)</span>
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
    left: -4px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(201,168,76,0.1);
  }
  .bracket-col:not(:first-child)::after {
    content: '';
    position: absolute;
    left: -4px;
    top: 50%;
    width: 4px;
    height: 1px;
    background: rgba(201,168,76,0.1);
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

  /* Caret to reopen the 3rd-place selector on an already-filled wildcard slot,
     so a chosen third can be swapped for a different eligible third. Clicking it
     stops propagation so it doesn't also pick the team as the match winner. */
  .third-change {
    color: var(--text-muted);
    font-size: 11px;
    flex-shrink: 0;
    margin-left: 2px;
    padding: 0 4px;
    cursor: pointer;
    border-radius: 4px;
  }
  .third-change:hover { color: var(--accent); background: rgba(255,255,255,0.08); }

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
    margin: 14px 0 18px;
    padding: 14px 18px;
    background: rgba(201, 168, 76, 0.06);
    border: 1px solid rgba(201, 168, 76, 0.45);
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
    margin-bottom: 6px;
  }

  .tiebreaker-hint {
    font-size: 10px;
    color: var(--text-dim);
    margin-bottom: 12px;
    line-height: 1.4;
  }

  .tiebreaker-hint b {
    color: var(--text);
    font-weight: 600;
  }

  .tiebreaker-teamname {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 96px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tiebreaker-teamname-empty {
    color: var(--text-dim);
    font-weight: 400;
    font-style: italic;
  }

  .tiebreaker-inputs {
    display: flex;
    align-items: flex-end;
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
    margin-bottom: 6px;
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

  /* 3rd-place team selector */
  .third-selector-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200;
    display: flex; align-items: flex-end; justify-content: center;
    backdrop-filter: blur(2px);
  }
  .third-selector-sheet {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 16px 16px 0 0; padding: 20px;
    width: 100%; max-width: 480px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    max-height: 70vh; overflow-y: auto;
  }
  .third-selector-header {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; font-weight: 600; color: var(--gold);
    margin-bottom: 4px;
  }
  .third-selector-sub {
    font-size: 11px; color: var(--text-muted); margin: 0 0 16px;
  }
  .third-selector-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  .third-team-btn {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; cursor: pointer;
    transition: all 0.15s; text-align: left;
    color: var(--text);
  }
  .third-team-btn:hover { border-color: var(--gold); background: rgba(201,168,76,0.06); }
  .third-team-btn.selected { border-color: var(--gold); background: rgba(201,168,76,0.12); }
  .third-team-btn .team-flag { font-size: 16px; }
  .third-team-btn .team-name { flex: 1; font-size: 12px; }
  .third-team-btn .third-group-badge {
    font-size: 9px; background: rgba(201,168,76,0.15);
    color: var(--gold); border-radius: 4px; padding: 2px 5px;
  }
  .third-team-btn .pick-star { color: var(--gold); font-size: 12px; }
  .third-selector-empty {
    text-align: center; padding: 20px 0; font-size: 12px; color: var(--text-muted);
  }
  .third-selector-hint {
    text-align: center; font-size: 10px; color: var(--text-dim);
    margin: 12px 0 0; padding-top: 8px; border-top: 1px solid var(--border);
  }
  .team-tbd-btn { cursor: pointer; color: var(--gold) !important; }
  .team-tbd-btn:hover { text-decoration: underline; }

  /* Tap-pinned state: gold outline on the team whose path is locked */
  .team-btn.path-pinned {
    outline: 1.5px solid rgba(201, 168, 76, 0.6);
    outline-offset: -1px;
  }

  /* Tap-pinned state: gold outline on the team whose path is locked */
  .team-btn.path-pinned {
    outline: 1.5px solid rgba(201, 168, 76, 0.6);
    outline-offset: -1px;
  }
</style>