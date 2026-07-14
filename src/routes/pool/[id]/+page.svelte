<script lang="ts">
  import { haptic } from '$lib/haptic';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import { liveMatchIds } from '$lib/live.js';
  import Simulator from '$lib/Simulator.svelte';
  import Icon from '$lib/Icon.svelte';
  import { onMount } from 'svelte';
  let { data } = $props();
  let tab = $state(data.deadlinePassed ? 'leaderboard' : 'predictions');
  const tabIndexOrder = ['predictions', 'simulator', 'leaderboard', 'calendar', 'members', 'summary', 'results', 'scoring'];
  let slideDir = $state<'left' | 'right' | ''>('');
  let scrollY = $state(0);
  function switchTab(newTab: string) {
    if (newTab === tab) return; // already here — don't replay the slide (the "wiggle")
    haptic(8);
    const oldIdx = tabIndexOrder.indexOf(tab);
    const newIdx = tabIndexOrder.indexOf(newTab);
    slideDir = newIdx > oldIdx ? 'left' : 'right';
    tab = newTab;
    if (newTab === 'calendar') scrollToCurrentGame();
    if (newTab === 'simulator') loadSim();
  }

  // Lazy-load the simulator data the first time the tab is opened (keeps it off
  // the pool page's initial load). Renders inline via the shared component.
  let simData = $state<any>(null);
  let simLoading = $state(false);
  let simErr = $state('');
  async function loadSim() {
    if (simData || simLoading) return;
    simLoading = true; simErr = '';
    try {
      const r = await fetch(`/api/pools/${pool.id}/simulator`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) simErr = d.error || 'No se pudo cargar el simulador';
      else simData = d;
    } catch { simErr = 'Error de conexión'; }
    simLoading = false;
  }
  // Auto-scroll the Calendario to the live game (or the next one to be played).
  function scrollToCurrentGame() {
    if (typeof document === 'undefined' || scrollTargetId == null) return;
    // Let the tab content render/animate in first, then centre the target row.
    setTimeout(() => {
      document.getElementById(`cal-m${scrollTargetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 90);
  }
  onMount(() => {
    if (tab === 'calendar') scrollToCurrentGame();
    const onScroll = () => { scrollY = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });
  let copied = $state(false);
  let summaryEntry = $state(data.predictions.length > 0 ? data.predictions[0].id : null);

  const pool = data.pool;

  // Payment status of the logged-in user (money pools only). `members` carries
  // each member's has_paid; match it to the current userId.
  const myMembership = $derived(data.members.find((mem: any) => mem.user_id === data.userId));
  const owesBuyIn = $derived(pool.buy_in > 0 && !!myMembership && !myMembership.has_paid);

  // Prize pot (money pools). The pot is the buy-in × members who have PAID; the
  // split mirrors the admin's "Reparto de premios" (1st 60% / 2nd 25% / 3rd 15%).
  const PRIZE_SPLITS = [
    { label: '1.º', pct: 0.6 },
    { label: '2.º', pct: 0.25 },
    { label: '3.º', pct: 0.15 },
  ];
  // Completeness for the "finish your picks" banner. With multiple entries the
  // banner reflects the FIRST INCOMPLETE one (showing only entry #1 told
  // multi-entry players "all complete" while another bet was unfinished);
  // only when every entry is complete does it go green.
  const isEntryComplete = (c) => !!c && c.groups >= c.groupsTotal && c.bracketDone && c.tiebreakerDone;
  const myCompletion = $derived.by(() => {
    if (data.predictions.length === 0) return null;
    const firstIncomplete = data.predictions.find((p) => !isEntryComplete(data.completion?.[p.id]));
    const target = firstIncomplete ?? data.predictions[0];
    return data.completion?.[target.id] ?? null;
  });
  const groupsDone = $derived(!!myCompletion && myCompletion.groups >= myCompletion.groupsTotal);
  const predComplete = $derived(!!myCompletion && groupsDone && myCompletion.bracketDone && myCompletion.tiebreakerDone);

  // Dense ranking ("1-2-2-3"): everyone level on points shares one position, and
  // the next distinct score is the next position — so with scores 2/1/0 you get a
  // bunch of 1st places, a bunch of 2nd, a bunch of 3rd (not "1st…then 6th").
  // A tie means that position's prize is shared. Leaderboard arrives sorted DESC.
  const leaderboardRanks = $derived.by(() => {
    const lb = (data.leaderboard ?? []) as any[];
    const ranks: number[] = [];
    let rank = 0;
    let prevScore: number | null = null;
    for (let i = 0; i < lb.length; i++) {
      if (lb[i].total_score !== prevScore) { rank += 1; prevScore = lb[i].total_score; }
      ranks[i] = rank;
    }
    return ranks;
  });

  // Matchday movers: change in rank since the last scored day's snapshot.
  // Positive = climbed (rank number dropped); negative = fell. 0 if no snapshot.
  const moverDeltas = $derived.by(() => {
    const lb = (data.leaderboard ?? []) as any[];
    const pr = (data.prevRank ?? {}) as Record<number, number>;
    return lb.map((e, i) => { const p = pr[e.id]; return p == null ? 0 : p - leaderboardRanks[i]; });
  });
  const topClimber = $derived.by(() => {
    let best = 0, bi = -1;
    moverDeltas.forEach((d, i) => { if (d > best) { best = d; bi = i; } });
    return bi >= 0 ? { entry: (data.leaderboard as any[])[bi], delta: best } : null;
  });
  const topFaller = $derived.by(() => {
    let worst = 0, wi = -1;
    moverDeltas.forEach((d, i) => { if (d < worst) { worst = d; wi = i; } });
    return wi >= 0 ? { entry: (data.leaderboard as any[])[wi], delta: -worst } : null;
  });

  // Fully locked = both deadlines passed → others' bets become viewable. Mirrors
  // the gate in results/+page.server.ts so a row only links when the target page
  // will actually honour the ?view=.
  const betsLocked = $derived.by(() => {
    const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
    const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
    const now = new Date();
    return !!dg && dg <= now && !!dk && dk <= now;
  });
  // The group games have begun (group deadline passed). Once true, the "saved"
  // banner moves out of the top into the Pronósticos tab under the cards.
  const gamesStarted = $derived.by(() => {
    const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
    return !!dg && dg <= new Date();
  });

  const paidCount = $derived(data.members.filter((m: any) => m.has_paid).length);
  const memberCount = $derived(data.members.length);
  // Buy-in is charged per bet (pronóstico), not per person: a member with 2
  // pronósticos contributes 2 buy-ins. The pot assumes every bet is paid.
  const predCount = $derived(((data.leaderboard as any[]) ?? []).length);
  const pot = $derived((Number(pool.buy_in) || 0) * predCount);
  const curSymbol = ({ EUR: '€', USD: '$', GBP: '£' } as Record<string, string>)[pool.currency] ?? '';
  const fmtMoney = (n: number) => curSymbol ? `${n.toFixed(2)}${curSymbol}` : `${n.toFixed(2)} ${pool.currency || ''}`.trim();

  // Prize per leaderboard entry — "combined positions" rule: entries level on
  // points share the SUMMED prizes for every finishing position they occupy,
  // split equally. So 5 tied for 1st occupy places 1–5 and share the 1st+2nd+3rd
  // prizes between them (no separate 2nd/3rd); 2 tied for 1st share 1st+2nd, then
  // a sole 3rd still gets the 3rd prize. Leaderboard arrives sorted by score DESC.
  const leaderboardPrizes = $derived.by(() => {
    const lb = (data.leaderboard ?? []) as any[];
    const out: number[] = new Array(lb.length).fill(0);
    if (pot <= 0) return out;
    const pcts = PRIZE_SPLITS.map((s) => s.pct); // 0-based finishing position → share
    let i = 0;
    while (i < lb.length) {
      let j = i;
      while (j < lb.length && lb[j].total_score === lb[i].total_score) j++;
      let sumPct = 0;
      for (let p = i; p < j; p++) sumPct += pcts[p] ?? 0; // positions beyond 3rd add 0
      const share = (pot * sumPct) / (j - i);
      for (let p = i; p < j; p++) out[p] = share;
      i = j;
    }
    return out;
  });
  const anyPrize = $derived(leaderboardPrizes.some((p) => p > 0));

  const phaseOrder = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  function teamName(id: number) { const n = data.teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function teamFlag(id: number) { return flagEmoji(data.teams[id]?.flag_code || ''); }

  const groupPreds = $derived.by(() => {
    if (!summaryEntry) return [];
    return data.groupPreds[summaryEntry] || [];
  });
  const bracketPredsByPhase = $derived.by(() => {
    if (!summaryEntry) return {};
    const raw = data.bracketPreds[summaryEntry] || [];
    const grouped: Record<string, any[]> = {};
    for (const b of raw) {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    }
    return grouped;
  });

  // Results helpers
  const resultsPhaseLabels: Record<string, string> = {
    group: 'Fase de Grupos', r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos',
    sf: 'Semifinales', '3rd': '3er y 4to puesto', final: 'Final',
  };
  const resultsPhaseOrder = ['group', 'r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  // Build bracket lookup for results comparison
  const bracketLookup: Record<string, Record<number, { team_id: number; points_earned: number }>> = {};
  for (const bp of data.userBracketPredsFull) {
    if (!bracketLookup[bp.phase]) bracketLookup[bp.phase] = {};
    bracketLookup[bp.phase][bp.match_index] = { team_id: bp.team_id, points_earned: bp.points_earned };
  }
  const groupPredLookup: Record<string, number[]> = {};
  for (const gp of data.userGroupPredsFull) {
    groupPredLookup[gp.group_name] = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
  }

  function getTeamName(id: number) { const n = data.resultsTeamCache[id]?.name; return n ? shortName(n) : 'TBD'; }
  function getTeamFlag(id: number) { return flagEmoji(data.resultsTeamCache[id]?.flag_code || ''); }
  function isGroupCorrect(groupName: string, position: number, actualTeamId: number) {
    const predicted = groupPredLookup[groupName]?.[position - 1];
    return predicted && predicted === actualTeamId;
  }
  function countFinished(phase: string) {
    return (data.resultsPhases[phase] || []).filter((m: any) => m.status === 'finished').length;
  }
  function countTotal(phase: string) {
    return (data.resultsPhases[phase] || []).length;
  }

  // ── Calendario: every fixture in kickoff order, with the user's pick + result ──
  const userMatchByMatch = $derived.by(() => {
    const m: Record<number, any> = {};
    for (const mp of (data.userMatchPredsFull || [])) m[mp.match_id] = mp;
    return m;
  });
  const userBracketByPhase = $derived.by(() => {
    const m: Record<string, Set<number>> = {};
    for (const bp of (data.userBracketPredsFull || [])) {
      if (bp.team_id == null) continue;
      (m[bp.phase] ??= new Set()).add(bp.team_id);
    }
    return m;
  });
  const outcomeOf = (h: number, a: number) => (h > a ? '1' : h < a ? '2' : 'X');
  // Returns { picked, correct } — correct is null when undecided or no pick.
  function matchVerdict(mt: any): { picked: string | null; correct: boolean | null } {
    const finished = mt.status === 'finished' && mt.home_score != null && mt.away_score != null;
    if (mt.phase === 'group') {
      const mp = userMatchByMatch[mt.id];
      const picked = (mp && mp.pred_home != null && mp.pred_away != null) ? outcomeOf(mp.pred_home, mp.pred_away) : null;
      if (!finished || picked == null) return { picked, correct: null };
      return { picked, correct: picked === outcomeOf(mt.home_score, mt.away_score) };
    }
    // Knockout: did the user advance the actual winner in this phase?
    if (!finished) return { picked: null, correct: null };
    const winner = mt.home_score > mt.away_score ? mt.home_team_id
      : mt.away_score > mt.home_score ? mt.away_team_id
      : (mt.penalty_winner_id ?? null);
    if (winner == null) return { picked: null, correct: null };
    return { picked: null, correct: !!userBracketByPhase[mt.phase]?.has(winner) };
  }
  const fmtDay = (iso: string) => { try { return new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; } };
  const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const calendarByDay = $derived.by(() => {
    const all: any[] = [];
    for (const phase of Object.keys(data.resultsPhases || {})) for (const mt of data.resultsPhases[phase]) all.push(mt);
    all.sort((a, b) => {
      const ta = a.kickoff_time ? new Date(a.kickoff_time).getTime() : Infinity;
      const tb = b.kickoff_time ? new Date(b.kickoff_time).getTime() : Infinity;
      return ta - tb || (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    const groups: { day: string; label: string; matches: any[] }[] = [];
    let cur: any = null;
    for (const mt of all) {
      const key = mt.kickoff_time ? new Date(mt.kickoff_time).toISOString().slice(0, 10) : 'tbd';
      if (!cur || cur.day !== key) { cur = { day: key, label: mt.kickoff_time ? fmtDay(mt.kickoff_time) : 'Por confirmar', matches: [] }; groups.push(cur); }
      cur.matches.push(mt);
    }
    return groups;
  });

  // Where the Calendario should jump to: a live game if any, else the next
  // not-yet-played fixture (matches are in kickoff order).
  const scrollTargetId = $derived.by(() => {
    let firstUpcoming: number | null = null;
    for (const g of calendarByDay) {
      for (const mt of g.matches) {
        if ($liveMatchIds.has(mt.id)) return mt.id;
        if (firstUpcoming == null && !(mt.status === 'finished' && mt.home_score != null)) firstUpcoming = mt.id;
      }
    }
    return firstUpcoming;
  });

  // ── Tap a calendar game → modal with everyone's bet on it (group games only,
  //    once the pool is locked). Fetched on demand from /api/pools/[id]/match-bets ──
  let matchBetsOpen = $state(false);
  let matchBetsLoading = $state(false);
  let matchBetsErr = $state('');
  let matchBetsData = $state<any>(null);
  async function openMatchBets(mt: any) {
    if (!betsLocked || mt.phase !== 'group') return;
    matchBetsOpen = true; matchBetsLoading = true; matchBetsErr = ''; matchBetsData = null;
    try {
      const r = await fetch(`/api/pools/${pool.id}/match-bets?match=${mt.id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) matchBetsErr = d.error || 'No se pudieron cargar las apuestas';
      else matchBetsData = d;
    } catch {
      matchBetsErr = 'Error de conexión';
    }
    matchBetsLoading = false;
  }
  function closeMatchBets() { matchBetsOpen = false; matchBetsData = null; }

  // ── Banter chat (opened from a floating button, not a tab) ──────────────────
  let chatOpen = $state(false);
  let chatMessages = $state<any[]>([]);
  let chatInput = $state('');
  let chatSending = $state(false);
  let chatErr = $state('');
  let chatLoaded = $state(false);
  let chatLastId = 0;
  let chatListEl: HTMLElement | null = null;

  function fmtChatTime(ts: string): string {
    try {
      const d = new Date(ts), now = new Date();
      const t = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${t}`;
    } catch { return ''; }
  }
  function chatNearBottom(): boolean {
    return !chatListEl || chatListEl.scrollHeight - chatListEl.scrollTop - chatListEl.clientHeight < 90;
  }
  function chatScrollBottom() {
    setTimeout(() => { if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight; }, 30);
  }
  async function loadChat() {
    try {
      const r = await fetch(`/api/pools/${pool.id}/messages`);
      if (!r.ok) return;
      const d = await r.json();
      chatMessages = d.messages || [];
      chatLastId = chatMessages.length ? chatMessages[chatMessages.length - 1].id : 0;
      chatLoaded = true;
      chatScrollBottom();
    } catch { /* keep last */ }
  }
  async function pollChat() {
    try {
      const r = await fetch(`/api/pools/${pool.id}/messages?after=${chatLastId}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.messages?.length) {
        const stick = chatNearBottom();
        chatMessages = [...chatMessages, ...d.messages];
        chatLastId = chatMessages[chatMessages.length - 1].id;
        if (stick) chatScrollBottom();
      }
    } catch { /* keep last */ }
  }
  async function sendChat() {
    const body = chatInput.trim();
    if (!body || chatSending) return;
    chatSending = true; chatErr = '';
    try {
      const r = await fetch(`/api/pools/${pool.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { chatErr = d.error || 'No se pudo enviar'; }
      else {
        chatInput = '';
        if (d.message && d.message.id > chatLastId) { chatMessages = [...chatMessages, d.message]; chatLastId = d.message.id; chatScrollBottom(); }
      }
    } catch { chatErr = 'Error de conexión'; }
    chatSending = false;
  }
  async function deleteChat(id: number) {
    try {
      const r = await fetch(`/api/pools/${pool.id}/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (r.ok) chatMessages = chatMessages.filter((m) => m.id !== id);
    } catch { /* ignore */ }
  }
  function openChat() { chatOpen = true; haptic(8); }
  function closeChat() { chatOpen = false; }
  // Poll only while the chat overlay is open AND the app is foregrounded — keeps
  // it cheap on the DB (incremental, returns 0 rows most of the time).
  $effect(() => {
    if (!chatOpen || typeof document === 'undefined') return;
    if (!chatLoaded) loadChat(); else { pollChat(); chatScrollBottom(); }
    const iv = setInterval(() => { if (document.visibilityState === 'visible') pollChat(); }, 10_000);
    return () => clearInterval(iv);
  });
  // The back-to-top FAB shows on the long tabs once scrolled; the chat FAB then
  // sits above it.
  const showScrollTop = $derived((tab === 'calendar' || tab === 'leaderboard') && scrollY > 320);

  const tabs = [
    { id: 'predictions', icon: 'sparkles', label: 'Pronósticos' },
    { id: 'simulator', icon: 'route', label: 'Simulador' },
    { id: 'leaderboard', icon: 'medal', label: 'Clasificación' },
    { id: 'calendar', icon: 'calendar', label: 'Calendario' },
    { id: 'members', icon: 'users', label: 'Miembros' },
    { id: 'summary', icon: 'clipboard', label: 'Resumen' },
    { id: 'results', icon: 'trophy', label: 'Resultados' },
    { id: 'scoring', icon: 'hash', label: 'Puntuación' },
  ];

  const phaseLabels: Record<string, string> = {
    group: 'Grupos',
    r32: 'Dieciseisavos',
    r16: 'Octavos',
    qf: 'Cuartos',
    sf: 'Semifinales',
    final: 'Final',
    '3rd': '3er puesto',
  };

  // Does this pool award points for the final group standings? When it does, the
  // leaderboard pills show a "Posición +N" segment so the row's points add up to
  // its total (otherwise a lower aciertos count outranking a higher one looks like
  // a bug). Pools with group_position = 0 behave exactly as before.
  const awardsPosition = $derived(Number(data.scoring?.group_position ?? 0) > 0);

  let shared = $state(false);
  let sheetOpen = $state(false);
  let sheetStartY = 0;
  let sheetDrag = $state(0);

  function openSheet() { sheetOpen = true; haptic(8); }
  function closeSheet() { sheetOpen = false; sheetDrag = 0; }
  function onSheetTouchStart(e: TouchEvent) { sheetStartY = e.touches[0].clientY; }
  function onSheetTouchMove(e: TouchEvent) {
    if (!sheetOpen) return;
    const dy = e.touches[0].clientY - sheetStartY;
    sheetDrag = Math.max(0, dy);
  }
  function onSheetTouchEnd() {
    if (sheetDrag > 80) closeSheet();
    else sheetDrag = 0;
    sheetStartY = 0;
  }

  function copyCode() {
    const url = `${window.location.origin}/join/${pool.invite_code}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    }
  }

  function shareScoreboard() {
    // The public scoreboard route (/s/[code]) resolves the pool by share_token
    // (NOT invite_code — a public viewer must not be able to use it to join).
    const url = `${window.location.origin}/s/${pool.share_token}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        shared = true;
        setTimeout(() => { shared = false; }, 2000);
      });
    } else {
      // Fallback for HTTP
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      shared = true;
      setTimeout(() => { shared = false; }, 2000);
    }
  }
</script>

<div class="pool-page" style="flex: 1; display: flex; flex-direction: column;">
  <!-- Sticky Back Link -->
  <div class="pool-crumb" style="position: sticky; top: 0; z-index: 10; background: var(--bg-base); padding: 8px 0; margin-bottom: 8px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
    <a href="/" style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; text-decoration: none;">← Quinielas</a>
    <span style="color: var(--border);">/</span>
    <span style="color: var(--gold);">{pool.name}</span>
  </div>

  <!-- Content -->
  <div style="flex: 1; display: flex; flex-direction: column;">

  <!-- Pool Header -->
  <div style="margin-bottom: 18px; padding: 14px 16px; background: linear-gradient(135deg, rgba(201,168,76,0.08) 0%, transparent 100%); border-radius: 14px; border: 1px solid rgba(201,168,76,0.12);">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
      <div style="min-width: 0;">
        <h1 class="pool-title" style="font-family: 'Libre Baskerville', serif; color: var(--gold); margin-bottom: 6px;">{pool.name}</h1>
        <div class="pool-meta" style="display: flex; gap: 12px; flex-wrap: wrap; color: var(--text-muted);">
          <span title="Miembros">👥 {data.members.length}</span>
          {#if pool.buy_in > 0}
            <span title="Entrada">💰 {fmtMoney(Number(pool.buy_in) || 0)}</span>
            {#if pot > 0}
              <span title="Bote" style="color: var(--gold);">🏆 {fmtMoney(pot)}</span>
            {/if}
          {/if}
        </div>
      </div>
      <button onclick={openSheet} aria-label="Opciones" style="flex-shrink: 0; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 16px; color: var(--text-muted); cursor: pointer; line-height: 1;">⋯</button>
    </div>
  </div>

  <!-- Payment-pending banner (money pools, current user not yet marked paid) -->
  {#if owesBuyIn}
    <div style="margin-bottom: 16px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; background: rgba(201,168,76,0.08); border: 1px solid var(--gold); border-radius: 10px;">
      <span style="font-size: 18px;">💰</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; font-weight: 600; color: var(--gold);">Entrada pendiente de pago</div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px; line-height: 1.4;">
          Aún no se ha registrado tu pago de <strong>{fmtMoney(Number(pool.buy_in) || 0)}</strong>. Paga al organizador; te marcará como pagado. Tus pronósticos cuentan igualmente.
        </div>
      </div>
    </div>
  {/if}

  <!-- Prediction-completeness banner. Before the games begin it sits up here to
       nudge completion; once they begin it moves into the Pronósticos tab. -->
  {#if myCompletion && !gamesStarted}
    {#if predComplete}
      <div style="margin-bottom: 16px; padding: 10px 14px; display: flex; align-items: center; gap: 8px; background: rgba(0,229,160,0.07); border: 1px solid rgba(0,229,160,0.3); border-radius: 10px;">
        <span style="font-size: 15px;">✅</span>
        <span style="font-size: 11px; color: var(--green);">Tus pronósticos están <strong>completos y guardados</strong>.</span>
      </div>
    {:else}
      <div style="margin-bottom: 16px; padding: 12px 14px; background: rgba(201,168,76,0.08); border: 1px solid var(--gold); border-radius: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 16px;">📋</span>
          <span style="font-size: 12px; font-weight: 600; color: var(--gold);">Aún te faltan pronósticos</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
          <span>{groupsDone ? '✅' : '⬜'} Grupos <strong style="color: var(--text);">{myCompletion.groups}/{myCompletion.groupsTotal}</strong></span>
          <span>{myCompletion.bracketDone ? '✅' : '⬜'} Cuadro eliminatorio</span>
          <span>{myCompletion.tiebreakerDone ? '✅' : '⬜'} Marcador de la final</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <a href="/pool/{pool.id}/{groupsDone ? 'bracket' : 'predict'}" class="btn-primary" style="display: inline-block; font-size: 10px; padding: 7px 16px;">Completar →</a>
          <span style="font-size: 9px; color: var(--text-dim);">Tus respuestas se guardan solas a medida que las haces.</span>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Tabs -->
  <div class="pool-tabs">
    {#each tabs as t}
      <button
        onclick={() => switchTab(t.id)}
        class="pool-tab"
        class:active={tab === t.id}
      ><span class="pool-tab-inner"><Icon name={t.icon} size={15} /> {t.label}</span></button>
    {/each}
  </div>

  <!-- Tab Content with slide animation. After the slide finishes we reset to a
       NEUTRAL state (no slide-* class) — resetting to 'left' used to change the
       class and replay the animation when arriving from the right (the wiggle). -->
  <div class="tab-content-wrapper" class:slide-left={slideDir === 'left'} class:slide-right={slideDir === 'right'} onanimationend={() => slideDir = ''}>
  <!-- Clasificación -->
  {#if tab === 'leaderboard'}
    {#if data.leaderboard == null}
      <!-- Skeleton -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        {#each [1,2,3,4,5] as _}
          <div style="display: flex; align-items: center; gap: 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div class="skeleton skeleton-circle"></div>
            <div style="flex: 1;">
              <div class="skeleton skeleton-text medium" style="width: 140px;"></div>
              <div class="skeleton skeleton-text short" style="margin-top: 6px; width: 100px;"></div>
            </div>
            <div class="skeleton" style="height: 20px; width: 32px;"></div>
          </div>
        {/each}
      </div>
    {:else if data.leaderboard.length === 0}
      <div style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 40px; margin-bottom: 12px;">📊</div>
        <h3 style="font-size: 16px; color: var(--gold); margin-bottom: 8px;">Sin pronósticos aún</h3>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Sé el primero en predecir los resultados del Mundial.</p>
        <a href="/pool/{pool.id}/predict" class="btn-primary" style="display: inline-block; font-size: 11px; padding: 10px 24px;">¡Predice ahora!</a>
      </div>
    {:else}
      {@const myIndex = data.leaderboard.findIndex((e: any) => e.user_id === data.userId)}
      {@const myEntry = myIndex >= 0 ? data.leaderboard[myIndex] : null}
      {@const prevEntry = myIndex > 0 ? data.leaderboard[myIndex - 1] : null}
      {@const nextEntry = myIndex < data.leaderboard.length - 1 ? data.leaderboard[myIndex + 1] : null}

      <!-- Matchday movers -->
      {#if topClimber || topFaller}
        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
          {#if topClimber}
            <div style="flex: 1; min-width: 0; background: rgba(0,229,160,0.06); border: 1px solid rgba(0,229,160,0.22); border-radius: 8px; padding: 8px 10px;">
              <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;">📈 Sube</div>
              <div style="font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{topClimber.entry.display_name}</div>
              <div style="font-size: 10px; color: var(--green); font-weight: 700;">▲ {topClimber.delta} {topClimber.delta === 1 ? 'puesto' : 'puestos'}</div>
            </div>
          {/if}
          {#if topFaller}
            <div style="flex: 1; min-width: 0; background: rgba(255,77,106,0.05); border: 1px solid rgba(255,77,106,0.2); border-radius: 8px; padding: 8px 10px;">
              <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;">📉 Baja</div>
              <div style="font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{topFaller.entry.display_name}</div>
              <div style="font-size: 10px; color: var(--red); font-weight: 700;">▼ {topFaller.delta} {topFaller.delta === 1 ? 'puesto' : 'puestos'}</div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Prize pot banner -->
      {#if anyPrize}
        <div style="margin-bottom: 12px; padding: 10px 14px; background: rgba(0,229,160,0.06); border: 1px solid rgba(0,229,160,0.25); border-radius: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span style="font-size: 11px; color: var(--text-muted);">🏆 Bote</span>
            <strong style="font-size: 14px; color: var(--green);">{fmtMoney(pot)}</strong>
          </div>
          <p style="font-size: 9px; color: var(--text-dim); margin: 4px 0 0; line-height: 1.4;">
            Repartido {PRIZE_SPLITS.map((s) => `${(s.pct * 100).toFixed(0)}%`).join(' / ')} entre los 3 primeros. Los empates se reparten a partes iguales el premio de los puestos que ocupan. {paidCount}/{memberCount} han pagado.
          </p>
        </div>
      {/if}

      <!-- Your position card -->
      {#if myEntry && data.leaderboard.length > 5}
        <div style="background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.25); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; cursor: pointer;" onclick={() => document.getElementById('my-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="font-size: 22px; font-weight: 800; color: var(--gold);">{leaderboardRanks[myIndex]}º</div>
              <div>
                <div style="font-size: 12px; font-weight: 600; color: var(--gold);">Tu posición</div>
                <div style="font-size: 10px; color: var(--text-muted);">{myEntry.total_score} pts</div>
              </div>
            </div>
            <div style="text-align: right;">
              {#if prevEntry}
                <div style="font-size: 9px; color: var(--text-muted);">
                  {prevEntry.total_score - myEntry.total_score > 0 ? `${prevEntry.total_score - myEntry.total_score} pts para ${leaderboardRanks[myIndex - 1]}º` : `¡empatado con ${leaderboardRanks[myIndex - 1]}º!`}
                </div>
              {/if}
              {#if data.leaderboard.length > 3}
                <div style="font-size: 8px; color: var(--text-dim); margin-top: 2px;">toca para ir</div>
              {/if}
            </div>
          </div>
          <!-- Mis rivales: who you're chasing and who's chasing you -->
          {#if prevEntry || nextEntry}
            <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(201,168,76,0.18);">
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;">A quien persigues</div>
                {#if prevEntry}
                  <div style="font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">⬆️ {prevEntry.display_name}{#if pool.allow_multiple_predictions && prevEntry.label} · {prevEntry.label}{/if}</div>
                  <div style="font-size: 9px; color: var(--gold);">{prevEntry.total_score - myEntry.total_score === 0 ? 'empatados' : `te saca ${prevEntry.total_score - myEntry.total_score} pts`}</div>
                {:else}
                  <div style="font-size: 11px; font-weight: 600; color: var(--gold);">👑 ¡Lideras!</div>
                {/if}
              </div>
              <div style="flex: 1; min-width: 0; text-align: right;">
                <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;">Quien te persigue</div>
                {#if nextEntry}
                  <div style="font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{nextEntry.display_name}{#if pool.allow_multiple_predictions && nextEntry.label} · {nextEntry.label}{/if} ⬇️</div>
                  <div style="font-size: 9px; color: var(--text-muted);">{myEntry.total_score - nextEntry.total_score === 0 ? 'empatados' : `a ${myEntry.total_score - nextEntry.total_score} pts`}</div>
                {:else}
                  <div style="font-size: 11px; font-weight: 600; color: var(--text-muted);">eres el farolillo 🏮</div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Stats / compare / share buttons -->
      <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; margin-bottom: 4px;">
        {#if betsLocked}
          <a href="/pool/{pool.id}/stats" style="border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: var(--text-muted); text-decoration: none; margin-right: auto; display: inline-flex; align-items: center; gap: 5px;"><Icon name="chart" size={13} /> Estadísticas</a>
          <a href="/pool/{pool.id}/h2h" style="border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: var(--text-muted); text-decoration: none; display: inline-flex; align-items: center; gap: 5px;"><Icon name="swords" size={13} /> Comparar</a>
        {/if}
        <button onclick={() => { shareScoreboard(); haptic(10); }} style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: {shared ? 'var(--green)' : 'var(--text-muted)'}; cursor: pointer;">
          {shared ? '✓ Enlace copiado' : '🔗 Compartir'}
        </button>
      </div>

      {#if betsLocked}
        <p style="font-size: 9px; color: var(--text-dim); margin: 0 0 6px 2px;">🔓 Las apuestas están bloqueadas — toca a cualquiera para ver sus pronósticos.</p>
      {/if}
      <div style="display: flex; flex-direction: column; gap: 8px;">
        {#each data.leaderboard as entry, i}
          {@const mine = entry.user_id === data.userId}
          {@const rank = leaderboardRanks[i]}
          <svelte:element this={betsLocked ? 'a' : 'div'} href={betsLocked ? `/pool/${pool.id}/summary?view=${entry.id}` : undefined} id={mine ? 'my-row' : ''} class="leaderboard-row" class:is-me={mine} class:is-first={rank === 1} class:is-link={betsLocked}>
            <div class="lb-avatar" style={rank === 1 ? 'background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e;' : rank === 2 ? 'background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e;' : rank === 3 ? 'background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e;' : 'background: rgba(255,255,255,0.06); color: var(--text-dim);'}>
              {entry.display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div class="lb-main">
              <div class="lb-name" class:mine>{rank}.{#if moverDeltas[i] !== 0}<span class="lb-mover" style="color: {moverDeltas[i] > 0 ? 'var(--green)' : 'var(--red)'};">{moverDeltas[i] > 0 ? '▲' : '▼'}{Math.abs(moverDeltas[i])}</span>{/if} {entry.display_name}{#if pool.allow_multiple_predictions}<span class="lb-label"> · {entry.label || 'Principal'}</span>{:else if entry.label}<span class="lb-label"> ({entry.label})</span>{/if}</div>
              <div class="lb-tags">
                {#if entry.result_points > 0}
                  <span class="lb-tag">Resultados +{entry.result_points}</span>
                {/if}
                {#if awardsPosition && entry.position_points > 0}
                  <span class="lb-tag">Posición +{entry.position_points}</span>
                {/if}
                {#each Object.entries(entry.bracket_points || {}) as [phase, pts]}
                  <span class="lb-tag">{phaseLabels[phase] || phase} +{pts}</span>
                {/each}
              </div>
            </div>
            <div class="lb-score">
              <div class="lb-pts">{entry.total_score}</div>
              <div class="lb-pts-label">pts</div>
              {#if leaderboardPrizes[i] > 0}<div class="lb-prize">💰 {fmtMoney(leaderboardPrizes[i])}</div>{/if}
            </div>
            {#if betsLocked}<span class="lb-chevron">›</span>{/if}
          </svelte:element>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- Calendario Tab -->
  {#if tab === 'calendar'}
    <div style="max-width: 900px; margin: 0 auto;">
      <p style="font-size: 10px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5;">
        Todos los partidos en orden. ✓ = acertaste el ganador (o el 1/X/2 en grupos), ✗ = fallaste.
        {#if data.predictions.length === 0}<br><span style="color: var(--text-dim);">Haz tus pronósticos para ver tus aciertos.</span>{/if}
      </p>
      {#each calendarByDay as group}
        <div style="margin-bottom: 18px;">
          <div style="font-size: 10px; font-weight: 600; color: var(--gold); text-transform: capitalize; letter-spacing: 0.04em; margin-bottom: 8px; position: sticky; top: 40px; background: var(--bg-base); padding: 2px 0;">{group.label}</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 5px 10px; align-items: start;">
            {#each group.matches as mt}
              {@const finished = mt.status === 'finished' && mt.home_score != null}
              {@const live = !finished && ($liveMatchIds.has(mt.id) || mt.status === 'live')}
              {@const v = matchVerdict(mt)}
              {@const homeWin = finished && mt.home_score > mt.away_score}
              {@const awayWin = finished && mt.away_score > mt.home_score}
              {@const clickable = betsLocked && mt.phase === 'group'}
              <svelte:element this={clickable ? 'button' : 'div'} type={clickable ? 'button' : undefined} onclick={clickable ? () => openMatchBets(mt) : undefined} id="cal-m{mt.id}" class="cal-row" class:cal-live={live} style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; color: inherit; background: var(--bg-card); border: 1px solid {v.correct === true ? 'rgba(0,229,160,0.3)' : v.correct === false ? 'rgba(255,77,106,0.25)' : 'var(--border)'}; border-radius: 7px; padding: 8px 10px; {clickable ? 'cursor: pointer;' : ''}">
                <!-- phase / time -->
                <div style="width: 42px; flex-shrink: 0; text-align: center;">
                  {#if mt.phase !== 'group'}
                    <div style="font-size: 8px; color: var(--gold); text-transform: uppercase; line-height: 1.2;">{resultsPhaseLabels[mt.phase]?.slice(0, 8) || mt.phase}</div>
                  {/if}
                  <div style="font-size: 9px; color: var(--text-muted);">{mt.kickoff_time ? fmtTime(mt.kickoff_time) : '—'}</div>
                </div>
                <!-- teams -->
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                  <div style="display: flex; align-items: center; gap: 5px; font-size: 12px; {homeWin ? 'font-weight: 700;' : finished ? 'color: var(--text-muted);' : ''}">
                    <span>{@html mt.home_flag ? flagEmoji(mt.home_flag) : ''}</span>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{mt.home_name ? shortName(mt.home_name) : 'Por definir'}</span>
                    {#if finished}<span style="font-weight: 700; color: {homeWin ? 'var(--text)' : 'var(--text-muted)'};">{mt.home_score}</span>{/if}
                  </div>
                  <div style="display: flex; align-items: center; gap: 5px; font-size: 12px; {awayWin ? 'font-weight: 700;' : finished ? 'color: var(--text-muted);' : ''}">
                    <span>{@html mt.away_flag ? flagEmoji(mt.away_flag) : ''}</span>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{mt.away_name ? shortName(mt.away_name) : 'Por definir'}</span>
                    {#if finished}<span style="font-weight: 700; color: {awayWin ? 'var(--text)' : 'var(--text-muted)'};">{mt.away_score}</span>{/if}
                  </div>
                </div>
                <!-- verdict / status -->
                <div style="flex-shrink: 0; text-align: right; min-width: 52px;">
                  {#if finished && mt.phase === 'group' && v.picked != null}
                    <!-- Finished group game: show the bet placed + whether it hit. -->
                    <div style="font-size: 8px; color: var(--text-dim); line-height: 1;">tu apuesta</div>
                    <div style="font-size: 12px; font-weight: 700; color: {v.correct ? 'var(--green)' : 'var(--red)'};">{v.picked} {v.correct ? '✓' : '✗'}</div>
                  {:else if v.correct === true}
                    <span style="font-size: 14px; color: var(--green);">✓</span>
                  {:else if v.correct === false}
                    <span style="font-size: 14px; color: var(--red);">✗</span>
                  {:else if finished}
                    <span style="font-size: 9px; color: var(--text-dim);">{mt.phase === 'group' && v.picked == null ? 'sin pronóstico' : 'final'}</span>
                  {:else if live}
                    <span style="display: inline-flex; align-items: center; gap: 5px; justify-content: flex-end;">
                      {#if mt.phase === 'group' && v.picked}<span style="font-size: 9px; color: var(--text-muted);">Tu: <strong style="color: var(--gold);">{v.picked}</strong></span>{/if}
                      <span class="cal-live-dot" aria-label="En juego"></span>
                    </span>
                  {:else if mt.phase === 'group' && v.picked}
                    <span style="font-size: 9px; color: var(--text-muted);">Tu: <strong style="color: var(--gold);">{v.picked}</strong></span>
                  {:else}
                    <span style="font-size: 9px; color: var(--text-dim);">próximo</span>
                  {/if}
                </div>
                {#if clickable}<span style="flex-shrink: 0; font-size: 13px; color: var(--text-dim); margin-left: -2px;">›</span>{/if}
              </svelte:element>
            {/each}
          </div>
        </div>
      {/each}
      {#if calendarByDay.length === 0}
        <p style="font-size: 11px; color: var(--text-muted); padding: 12px; text-align: center;">El calendario aún no está disponible.</p>
      {/if}
      {#if betsLocked}
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 6px; text-align: center;">Toca un partido de la fase de grupos para ver qué apostó cada uno.</p>
      {/if}
    </div>

    <!-- Per-match "what everyone bet" modal -->
    {#if matchBetsOpen}
      <div role="presentation" class="match-bets-overlay" onclick={closeMatchBets} style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1300; display: flex; justify-content: center;">
        <div role="dialog" aria-modal="true" class="match-bets-sheet" onclick={(e) => e.stopPropagation()} style="width: 100%; max-width: 520px; max-height: 85vh; overflow-y: auto; background: var(--bg-base); border: 1px solid var(--border); padding: 8px 16px calc(env(safe-area-inset-bottom, 0px) + 20px); box-shadow: 0 -8px 30px rgba(0,0,0,0.5);">
          <div style="display: flex; justify-content: flex-end;">
            <button onclick={closeMatchBets} aria-label="Cerrar" style="background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 2px 6px;">✕</button>
          </div>
          {#if matchBetsLoading}
            <p style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 24px;">Cargando apuestas…</p>
          {:else if matchBetsErr}
            <p style="text-align: center; color: var(--red); font-size: 12px; padding: 24px;">{matchBetsErr}</p>
          {:else if matchBetsData}
            {@const mb = matchBetsData}
            {@const total = mb.bets.length || 1}
            <div style="text-align: center; margin-bottom: 14px;">
              <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em;">Grupo {mb.match.group_name}</div>
              <div style="font-size: 15px; font-weight: 700; margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;">
                <span>{@html mb.match.home_flag ? flagEmoji(mb.match.home_flag) : ''} {mb.match.home_name ? shortName(mb.match.home_name) : ''}</span>
                {#if mb.match.finished}<span style="color: var(--gold);">{mb.match.home_score}-{mb.match.away_score}</span>{:else}<span style="color: var(--text-dim); font-size: 12px;">vs</span>{/if}
                <span>{mb.match.away_name ? shortName(mb.match.away_name) : ''} {@html mb.match.away_flag ? flagEmoji(mb.match.away_flag) : ''}</span>
              </div>
            </div>
            {#each [['1', `Gana ${shortName(mb.match.home_name || 'local')}`], ['X', 'Empate'], ['2', `Gana ${shortName(mb.match.away_name || 'visitante')}`]] as [code, label]}
              {@const picks = mb.bets.filter((b: any) => b.pick === code)}
              {@const n = mb.tally[code] || 0}
              {@const isActual = mb.match.finished && mb.match.actual === code}
              <div style="margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                  <span style="font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 5px; background: {code === 'X' ? 'rgba(255,255,255,0.08)' : 'rgba(201,168,76,0.16)'}; color: {code === 'X' ? 'var(--text-muted)' : 'var(--gold)'};">{code}</span>
                  <span style="font-size: 11px; color: var(--text); font-weight: 600;">{label}</span>
                  <span style="font-size: 10px; color: var(--text-muted);">· {n} ({Math.round((n / total) * 100)}%)</span>
                  {#if isActual}<span style="font-size: 10px; color: var(--green); font-weight: 700; margin-left: auto;">✓ resultado</span>{/if}
                </div>
                {#if picks.length > 0}
                  <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    {#each picks as b}
                      <span style="font-size: 10px; padding: 3px 8px; border-radius: 12px; background: var(--bg-surface); border: 1px solid {b.correct === true ? 'rgba(0,229,160,0.4)' : b.correct === false ? 'rgba(255,77,106,0.3)' : 'var(--border)'}; color: {b.correct === true ? 'var(--green)' : b.correct === false ? 'var(--text-muted)' : 'var(--text)'};">{b.name}{#if b.label} · {b.label}{/if}</span>
                    {/each}
                  </div>
                {:else}
                  <div style="font-size: 10px; color: var(--text-dim);">Nadie</div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Simulador Tab (inline, lazy-loaded) -->
  {#if tab === 'simulator'}
    {#if simErr}
      <p style="font-size: 12px; color: var(--red); padding: 16px; text-align: center;">{simErr}</p>
    {:else if !simData}
      <p style="font-size: 12px; color: var(--text-muted); padding: 24px; text-align: center;">Cargando simulador…</p>
    {:else}
      <div class="sim-breakout"><Simulator data={simData} /></div>
    {/if}
  {/if}

  <!-- Pronósticos Tab -->
  {#if tab === 'predictions'}
    {#if data.predictions.length === 0}
      <div style="text-align: center; padding: 40px 20px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 320px; margin: 0 auto 24px;">
          <a href="/pool/{pool.id}/predict" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
            <span style="font-size: 24px;">📋</span>
            <span style="font-size: 12px; font-weight: 600; color: var(--text);">Fase de Grupos</span>
            <span style="font-size: 9px; color: var(--text-muted);">Predice 1 · X · 2</span>
          </a>
          <a href="/pool/{pool.id}/bracket" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
            <span style="font-size: 24px;">⚔️</span>
            <span style="font-size: 12px; font-weight: 600; color: var(--text);">Eliminatorias</span>
            <span style="font-size: 9px; color: var(--text-muted);">Cuadro completo</span>
          </a>
        </div>
        <h3 style="font-size: 16px; color: var(--gold); margin-bottom: 8px;">¡Empieza a predecir!</h3>
        <p style="font-size: 11px; color: var(--text-muted);">Rellena los resultados de cada grupo y luego el cuadro eliminatorio.</p>
      </div>
    {:else}
      {#each data.predictions as pred}
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 8px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
            <a href="/pool/{pool.id}/predict" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
              <span style="font-size: 24px;">📋</span>
              <span style="font-size: 12px; font-weight: 600; color: var(--text);">Fase de Grupos</span>
              <span style="font-size: 9px; color: var(--text-muted);">Predice 1 · X · 2</span>
            </a>
            <a href="/pool/{pool.id}/bracket" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
              <span style="font-size: 24px;">⚔️</span>
              <span style="font-size: 12px; font-weight: 600; color: var(--text);">Eliminatorias</span>
              <span style="font-size: 9px; color: var(--text-muted);">Cuadro completo</span>
            </a>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
            <span>{pred.label || 'Apuesta principal'}</span>
            <span style="color: var(--gold); font-weight: 600;">{pred.total_score} pts</span>
          </div>
        </div>
      {/each}
      {#if gamesStarted}
        <div style="margin-top: 4px; padding: 10px 14px; display: flex; align-items: center; gap: 8px; background: rgba(0,229,160,0.07); border: 1px solid rgba(0,229,160,0.3); border-radius: 10px;">
          <span style="font-size: 15px;">✅</span>
          <span style="font-size: 11px; color: var(--green);">Tus pronósticos están <strong>{predComplete ? 'completos y guardados' : 'guardados'}</strong>.</span>
        </div>
      {/if}
    {/if}
  {/if}


  <!-- Members Tab -->
  {#if tab === 'members'}
    {#if data.members == null}
      <div style="display: flex; flex-direction: column; gap: 6px;">
        {#each [1,2,3,4] as _}
          <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
            <div class="skeleton skeleton-text medium" style="width: 120px;"></div>
            <div class="skeleton skeleton-text short"></div>
          </div>
        {/each}
      </div>
    {:else}
    <div style="display: flex; flex-direction: column; gap: 6px;">
      {#each data.members as member}
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
          <span style="font-size: 12px;">{member.display_name}</span>
          {#if pool.buy_in > 0}
            <span style="font-size: 9px; color: {member.has_paid ? 'var(--green)' : 'var(--red)'}; letter-spacing: 0.1em; text-transform: uppercase;">
              {member.has_paid ? '✓ Pagado' : '✗ Pendiente'}
            </span>
          {/if}
        </div>
      {/each}
    </div>
    {/if}
  {/if}

  <!-- Scoring Tab — friendly explanation using this pool's actual values -->
  {#if tab === 'scoring'}
    {@const s = data.scoring}
    {@const n = (k, d = 0) => Number(s?.[k] ?? d)}
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <p style="font-size: 11px; color: var(--text-muted); line-height: 1.55;">
        Sumas puntos acertando el resultado (1/X/2) de los partidos de grupos, qué equipos avanzan en el cuadro eliminatorio, y el marcador de la final (desempate).
      </p>

      <!-- Groups -->
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--gold); margin-bottom: 8px;">🏆 Fase de grupos</div>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Pronostica el resultado de cada partido — <strong>1</strong> (gana local), <strong>X</strong> (empate) o <strong>2</strong> (gana visitante). La clasificación de cada grupo se calcula sola a partir de tus aciertos.</p>
        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text);">
          <div style="display: flex; justify-content: space-between;"><span>Cada resultado acertado (1 / X / 2)</span><strong style="color: var(--gold);">+{n('match_outcome')}</strong></div>
          {#if n('group_position') > 0}
            <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border); margin-top: 4px; padding-top: 6px;"><span>Cada puesto acertado de la tabla final</span><strong style="color: var(--gold);">+{n('group_position')}</strong></div>
            <p style="font-size: 10px; color: var(--text-muted); margin-top: 7px; line-height: 1.5; background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.2); border-radius: 6px; padding: 7px 9px;">⏳ Los <strong>puntos por la tabla final</strong> se suman <strong>cuando termina el grupo</strong> (sus 6 partidos). Durante la fase de grupos solo cuentan los resultados 1/X/2 — por eso tus aciertos de posición aún figuran en 0.</p>
          {/if}
        </div>
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 8px; line-height: 1.5;">Hasta <strong>{6 * n('match_outcome') + 4 * n('group_position')} pts</strong> por grupo {#if n('group_position') > 0}(6 resultados + 4 posiciones){:else}(6 partidos){/if} · <strong>{72 * n('match_outcome') + 48 * n('group_position')}</strong> en total.</p>
      </div>

      <!-- Bracket -->
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--gold); margin-bottom: 8px;">⚔️ Cuadro eliminatorio</div>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Acierta qué equipo supera cada ronda:</p>
        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text);">
          <div style="display: flex; justify-content: space-between;"><span>Dieciseisavos</span><strong style="color: var(--gold);">+{n('knockout_r32')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Octavos</span><strong style="color: var(--gold);">+{n('knockout_r16')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Cuartos</span><strong style="color: var(--gold);">+{n('knockout_qf')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Semifinales</span><strong style="color: var(--gold);">+{n('knockout_sf')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Llegar a la final</span><strong style="color: var(--gold);">+{n('knockout_final')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Campeón (adicional)</span><strong style="color: var(--gold);">+{n('knockout_winner')}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Ganar el 3.er puesto</span><strong style="color: var(--gold);">+{n('third_place')}</strong></div>
        </div>
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 8px;">Acertar el campeón vale <strong>{n('knockout_final') + n('knockout_winner')} pts</strong> (final + campeón).</p>
      </div>

      <!-- Tiebreaker -->
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--gold); margin-bottom: 6px;">⚖️ Desempate</div>
        <p style="font-size: 11px; color: var(--text-muted); line-height: 1.5;">Si dos personas terminan empatadas a puntos, gana quien más se acerque al marcador real de la final.</p>
      </div>

      <!-- Prize split (money pools only) -->
      {#if pool.buy_in > 0}
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--gold); margin-bottom: 8px;">💰 Reparto del bote</div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">
            <span>Entrada por persona</span><strong style="color: var(--text);">{fmtMoney(Number(pool.buy_in) || 0)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
            <span>Bote actual ({paidCount}/{memberCount} pagado{paidCount === 1 ? '' : 's'})</span>
            <strong style="color: var(--gold);">{fmtMoney(pot)}</strong>
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text); border-top: 1px solid var(--border); padding-top: 8px;">
            {#each PRIZE_SPLITS as split}
              <div style="display: flex; justify-content: space-between;">
                <span>{split.label} puesto <span style="color: var(--text-dim); font-size: 10px;">({(split.pct * 100).toFixed(0)}%)</span></span>
                <strong style="color: var(--gold);">{pot > 0 ? fmtMoney(pot * split.pct) : '—'}</strong>
              </div>
            {/each}
          </div>
          <p style="font-size: 9px; color: var(--text-dim); margin-top: 8px; line-height: 1.5;">El bote crece a medida que los participantes pagan su entrada. El organizador gestiona los pagos y la entrega del premio.</p>
        </div>
      {/if}

      <p style="font-size: 10px; color: var(--text-dim); text-align: center;">Puntuación configurada por el creador de la quiniela.</p>
    </div>
  {/if}

   {#if tab === 'summary'}
    <div style="max-width: 900px; margin: 0 auto;">
      {#if data.predictions.length === 0}
        <div style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 40px; margin-bottom: 12px;">📋</div>
          <p style="font-size: 11px; color: var(--text-muted);">No tienes predicciones aún. <a href="/pool/{pool.id}/predict" style="color: var(--gold);">Predecir ahora</a></p>
        </div>
      {:else}
        <!-- Entry selector -->
        {#if data.predictions.length > 1}
          <div style="margin-bottom: 16px;">
            <select bind:value={summaryEntry} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
              {#each data.predictions as pred}
                <option value={pred.id}>{pred.label || 'Entrada principal'}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Group predictions -->
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🏆 Fase de Grupos</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; align-items: start;">
          {#each groupPreds as gp}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;">
              <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Grupo {gp.group_name}</div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                {#each [gp.position_1, gp.position_2, gp.position_3, gp.position_4] as tid, idx}
                  {#if tid}
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; {idx < 2 ? 'color: var(--text); font-weight: 500;' : 'color: var(--text-muted);'}">
                      <span style="width: 14px; font-size: 9px; color: var(--text-muted);">{idx + 1}.</span>
                      <span>{@html teamFlag(tid)}</span>
                      <span>{teamName(tid)}</span>
                    </div>
                  {:else}
                    <div style="font-size: 11px; color: var(--text-muted); opacity: 0.5;">{idx + 1}. —</div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
          </div>
          {#if groupPreds.length === 0}
            <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No has predicho grupos aún.</p>
          {/if}
        </div>

        <!-- Bracket predictions -->
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">⚔️ Eliminatorias</h2>
          {#each phaseOrder as phase}
            {@const bracketPreds = bracketPredsByPhase}
            {@const picks = bracketPreds[phase]}
            {#if picks && picks.length > 0}
              <div style="margin-bottom: 12px;">
                <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">{phaseLabels[phase] || phase}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  {#each picks as pick}
                    <span style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 11px;">
                      {@html teamFlag(pick.team_id)} {teamName(pick.team_id)}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
          {#if Object.keys(bracketPredsByPhase).length === 0}
            <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No has predicho eliminatorias aún.</p>
          {/if}
        </div>

        <div style="text-align: center; padding: 16px; border-top: 1px solid var(--border);">
          <p style="font-size: 9px; color: var(--text-muted);">📸 Haz captura para compartir</p>
        </div>
      {/if}
    </div>
  {/if}

   {#if tab === 'results'}
    <div style="max-width: 1000px; margin: 0 auto;">
      {#if data.predictions.length > 0}
        {@const totalUserPoints = data.userGroupPredsFull.reduce((sum: number, g: any) => sum + (g.points_earned || 0), 0) + data.userBracketPredsFull.reduce((sum: number, b: any) => sum + (b.points_earned || 0), 0) + (data.userMatchPredsFull || []).reduce((sum: number, m: any) => sum + (m.points_earned || 0), 0)}
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <span style="font-size: 11px; color: var(--text-muted);">Tu puntuación</span>
          <span style="font-size: 16px; font-weight: 700; color: var(--gold);">{totalUserPoints} pts</span>
        </div>
      {:else}
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 20px;">Aún no has hecho predicciones. <a href="/pool/{pool.id}/predict" style="color: var(--gold);">Predecir ahora</a></p>
      {/if}

      {#each resultsPhaseOrder as phase}
        {@const matches = data.resultsPhases[phase] || []}
        {@const finished = countFinished(phase)}
        {@const total = countTotal(phase)}

        {#if matches.length > 0}
          <div style="margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 0;">{resultsPhaseLabels[phase] || phase}</h2>
              <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 8px; border-radius: 8px;">{finished}/{total} jugados</span>
            </div>

            {#if phase === 'group'}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; align-items: start;">
              {#each Object.entries(data.resultsGroupStandings).sort(([a], [b]) => a.localeCompare(b)) as [group, teams]}
                {@const predicted = groupPredLookup[group]}
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px;">
                  <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px;">Grupo {group}</div>
                  <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                    <tbody>
                    <tr style="color: var(--text-muted); font-size: 9px;"><td style="padding: 2px 0; width: 24px;"></td><td style="padding: 2px 4px;"></td><td style="padding: 2px 4px; text-align: center;">Pts</td><td style="padding: 2px 4px; text-align: center;">GF</td><td style="padding: 2px 4px; text-align: center;">GC</td><td style="padding: 2px 4px; text-align: center;">DG</td>{#if predicted}<td style="padding: 2px 4px; text-align: center; font-size: 8px;">Pred.</td>{/if}</tr>
                    {#each teams as team, idx}
                      {@const correct = isGroupCorrect(group, idx + 1, team.id)}
                      <tr style="border-top: 1px solid var(--border); {idx < 2 ? 'color: var(--text);' : 'color: var(--text-muted);'}">
                        <td style="padding: 4px 0; font-size: 9px; color: var(--text-muted);">{idx + 1}</td>
                        <td style="padding: 4px;">{@html flagEmoji(team.flag_code)} {shortName(team.name)}</td>
                        <td style="padding: 4px; text-align: center; font-weight: 600;">{team.pts}</td>
                        <td style="padding: 4px; text-align: center;">{team.gf}</td>
                        <td style="padding: 4px; text-align: center;">{team.ga}</td>
                        <td style="padding: 4px; text-align: center;">{team.gd > 0 ? '+' : ''}{team.gd}</td>
                        {#if predicted}
                          <td style="padding: 4px; text-align: center;">{#if correct}<span style="color: var(--green); font-size: 10px;">✓</span>{:else if predicted[idx]}<span style="color: var(--text-muted); font-size: 9px;">✗</span>{:else}<span style="color: var(--text-muted); font-size: 9px;">—</span>{/if}</td>
                        {/if}
                      </tr>
                    {/each}
                    </tbody>
                  </table>
                </div>
              {/each}
              </div>
              {#if Object.keys(data.resultsGroupStandings).length === 0}
                <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No hay resultados de fase de grupos todavía.</p>
              {/if}
            {:else}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 8px; align-items: start;">
              {#each matches as match, mi}
                {@const pred = bracketLookup[phase]?.[mi]}
                {@const isFinished = match.status === 'finished'}
                {@const homeWin = isFinished && match.home_score > match.away_score}
                {@const awayWin = isFinished && match.away_score > match.home_score}
                <div>
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                  <span style="flex: 1; text-align: right; font-size: 12px; {homeWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">{@html flagEmoji(match.home_flag)} {match.home_name ? shortName(match.home_name) : 'TBD'}</span>
                  <div style="min-width: 56px; text-align: center;">
                    {#if isFinished}
                      <span style="font-size: 14px; font-weight: 700; color: var(--gold);">{match.home_score} - {match.away_score}</span>
                    {:else}
                      <span style="font-size: 9px; color: var(--text-muted);">Pend.</span>
                    {/if}
                  </div>
                  <span style="flex: 1; text-align: left; font-size: 12px; {awayWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">{match.away_name ? shortName(match.away_name) : 'TBD'} {@html flagEmoji(match.away_flag)}</span>
                </div>
                {#if pred && isFinished}
                  {@const actualWinner = homeWin ? match.home_team_id : awayWin ? match.away_team_id : null}
                  {@const correct = actualWinner && pred.team_id === actualWinner}
                  <div style="font-size: 9px; padding: 0 0 6px 0; text-align: center;">
                    Tu predicción: {@html getTeamFlag(pred.team_id)} {getTeamName(pred.team_id)}
                    {#if correct}<span style="color: var(--green);"> ✓ +{pred.points_earned}pts</span>{:else}<span style="color: var(--red);"> ✗</span>{/if}
                  </div>
                {/if}
                </div>
              {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}

      {#if Object.keys(data.resultsPhases).length === 0}
        <div style="text-align: center; padding: 40px 20px;">
          <p style="font-size: 32px; margin-bottom: 8px;">⚽</p>
          <p style="font-size: 12px; color: var(--text-muted);">Los resultados aparecerán aquí cuando comience el torneo.</p>
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Mundial 2026 · 11 de junio</p>
        </div>
      {/if}
    </div>
  {/if}
  </div>
  </div>
</div>

<!-- Bottom Sheet for Pool Actions -->
{#if sheetOpen}
  <div class="bottom-sheet-overlay" onclick={closeSheet} ontouchstart={onSheetTouchStart} ontouchmove={onSheetTouchMove} ontouchend={onSheetTouchEnd}
    onkeydown={(e) => { if (e.key === 'Escape') closeSheet(); }}
    role="dialog" aria-modal="true" tabindex="-1">
    <div class="bottom-sheet" style="transform: translateY({sheetDrag}px); padding-bottom: calc(20px + env(safe-area-inset-bottom));" ontouchstart={onSheetTouchStart} ontouchmove={onSheetTouchMove} ontouchend={onSheetTouchEnd} onclick={(e) => e.stopPropagation()}>
      <div class="bottom-sheet-handle"></div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <button onclick={() => { copyCode(); haptic(10); closeSheet(); }} style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; font-size: 13px; color: var(--text); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 12px; width: 100%;">
          <span style="font-size: 16px;">🔗</span> {copied ? '¡Copiado!' : 'Copiar enlace de invitación'}
        </button>
        <button onclick={() => { shareScoreboard(); haptic(10); closeSheet(); }} style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; font-size: 13px; color: var(--text); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 12px; width: 100%;">
          <span style="font-size: 16px;">📊</span> {shared ? '¡Copiado!' : 'Compartir clasificación'}
        </button>
        {#if data.isAdmin}
          <a href="/pool/{pool.id}/admin" onclick={() => haptic(10)} style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; font-size: 13px; color: var(--text); cursor: pointer; text-decoration: none; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 16px;">⚙️</span> Administración
          </a>
        {/if}
        <button onclick={() => { haptic(10); closeSheet(); }} style="background: none; border: none; border-top: 1px solid var(--border); padding: 16px; font-size: 13px; color: var(--text-muted); cursor: pointer; text-align: center; width: 100%; margin-top: 4px;">
          Cancelar
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Floating actions: back-to-top (when scrolled) + chat (always). Chat sits
     above the back-to-top button when both are showing. -->
{#if showScrollTop}
  <button onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} class="scroll-top-fab" aria-label="Volver arriba">↑</button>
{/if}
{#if !chatOpen}
  <button onclick={openChat} class="chat-fab" class:raised={showScrollTop} aria-label="Abrir chat de la quiniela">💬</button>
{/if}

{#if chatOpen}
  <div class="chat-overlay" role="dialog" aria-modal="true" onclick={closeChat}>
    <div class="chat-sheet" onclick={(e) => e.stopPropagation()}>
      <div class="chat-head">
        <span style="font-size: 13px; font-weight: 700; color: var(--gold);">💬 {pool.name}</span>
        <button onclick={closeChat} aria-label="Cerrar" style="background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 4px;">✕</button>
      </div>
      <div bind:this={chatListEl} class="chat-list">
        {#if !chatLoaded}
          <p class="chat-empty">Cargando…</p>
        {:else if chatMessages.length === 0}
          <p class="chat-empty">Aún no hay mensajes.<br>¡Rompe el hielo! 🧊</p>
        {:else}
          {#each chatMessages as m (m.id)}
            <div style="display: flex; flex-direction: column; align-items: {m.mine ? 'flex-end' : 'flex-start'};">
              <div style="max-width: 82%; background: {m.mine ? 'rgba(201,168,76,0.16)' : 'var(--bg-card)'}; border: 1px solid {m.mine ? 'rgba(201,168,76,0.3)' : 'var(--border)'}; border-radius: 12px; padding: 7px 11px;">
                {#if !m.mine}<div style="font-size: 9px; font-weight: 700; color: var(--gold); margin-bottom: 2px;">{m.display_name}</div>{/if}
                <div style="font-size: 12px; color: var(--text); white-space: pre-wrap; word-break: break-word; line-height: 1.4;">{m.body}</div>
                <div style="display: flex; align-items: center; gap: 7px; justify-content: flex-end; margin-top: 3px;">
                  <span style="font-size: 8px; color: var(--text-dim);">{fmtChatTime(m.created_at)}</span>
                  {#if m.mine || data.isAdmin}<button onclick={() => deleteChat(m.id)} aria-label="Borrar mensaje" style="background: none; border: none; color: var(--text-dim); font-size: 10px; cursor: pointer; padding: 0; line-height: 1;">✕</button>{/if}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
      <div class="chat-input-row">
        <input bind:value={chatInput} maxlength="500" placeholder="Escribe un mensaje…"
          onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
          style="flex: 1; min-width: 0; font-size: 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text);" />
        <button onclick={sendChat} disabled={chatSending || !chatInput.trim()} class="btn-primary" style="font-size: 11px; padding: 10px 16px; flex-shrink: 0;">Enviar</button>
      </div>
      {#if chatErr}<div style="font-size: 9px; color: var(--red); padding: 2px 2px 0;">{chatErr}</div>{/if}
    </div>
  </div>
{/if}

<style>
  /* ── Desktop pilot: Clasificación + shell ──────────────────────────────────
     Base values equal the previous inline px exactly, so the phone view is
     unchanged. Everything only grows behind @media (min-width: 768px). */
  .pool-crumb a, .pool-crumb span { font-size: 10px; }
  .pool-title { font-size: 22px; }
  .pool-meta { font-size: 11px; }

  .leaderboard-row {
    display: flex; align-items: center; gap: 12px;
    text-decoration: none; color: inherit;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
  }
  .leaderboard-row.is-link { cursor: pointer; }
  .leaderboard-row.is-first { border-color: rgba(201,168,76,0.2); box-shadow: 0 0 16px rgba(201,168,76,0.1); }
  .leaderboard-row.is-me { background: rgba(201,168,76,0.08); border-color: var(--gold); box-shadow: 0 0 12px rgba(201,168,76,0.15); }
  .lb-avatar {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px;
  }
  .lb-main { flex: 1; min-width: 0; }
  .lb-name { font-size: 13px; font-weight: 600; }
  .lb-name.mine { color: var(--gold); }
  .lb-mover { font-size: 9px; font-weight: 700; margin: 0 2px 0 3px; }
  .lb-label { color: var(--text-muted); font-weight: 400; }
  .lb-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .lb-tag { font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 3px; }
  .lb-score { text-align: right; flex-shrink: 0; }
  .lb-pts { font-size: 18px; font-weight: 700; color: var(--gold); line-height: 1.1; }
  .lb-pts-label { font-size: 9px; color: var(--text-muted); }
  .lb-prize { font-size: 10px; font-weight: 700; color: var(--green); margin-top: 3px; }
  .lb-chevron { font-size: 14px; color: var(--text-dim); margin-left: 2px; }

  @media (min-width: 768px) {
    .pool-page { max-width: 860px; margin: 0 auto; }
    .pool-crumb a, .pool-crumb span { font-size: 12px; }
    .pool-title { font-size: 30px; margin-bottom: 8px !important; }
    .pool-meta { font-size: 13px; gap: 16px !important; }

    .leaderboard-row { gap: 16px; padding: 16px 22px; border-radius: 10px; }
    .lb-avatar { width: 40px; height: 40px; font-size: 16px; }
    .lb-name { font-size: 15px; }
    .lb-mover { font-size: 11px; }
    .lb-tags { gap: 7px; margin-top: 6px; }
    .lb-tag { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
    .lb-pts { font-size: 24px; }
    .lb-pts-label { font-size: 10px; }
    .lb-prize { font-size: 12px; margin-top: 4px; }
    .lb-chevron { font-size: 18px; }
  }

  .scroll-top-fab {
    position: fixed;
    right: 16px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 76px);
    z-index: 60;
    width: 42px; height: 42px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: linear-gradient(135deg, #c9a84c, #e8c96a);
    color: #1a1a2e;
    font-size: 20px; font-weight: 700; line-height: 1;
    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    animation: fabIn 0.18s ease-out;
  }
  @keyframes fabIn { from { opacity: 0; transform: translateY(8px) scale(0.9); } to { opacity: 1; transform: none; } }
  @media (min-width: 768px) { .scroll-top-fab { bottom: 24px; } }

  /* Banter chat: floating button + bottom-sheet overlay */
  .chat-fab {
    position: fixed;
    right: 16px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 76px);
    z-index: 60;
    width: 48px; height: 48px;
    border-radius: 50%;
    border: 1px solid rgba(201,168,76,0.4);
    cursor: pointer;
    background: var(--bg-card);
    font-size: 22px; line-height: 1;
    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    transition: bottom 0.2s ease;
  }
  .chat-fab.raised { bottom: calc(env(safe-area-inset-bottom, 0px) + 130px); }
  @media (min-width: 768px) {
    .chat-fab { bottom: 24px; }
    .chat-fab.raised { bottom: 78px; }
  }
  .chat-overlay {
    position: fixed; inset: 0; z-index: 1300;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: flex-end; justify-content: center;
  }
  .chat-sheet {
    width: 100%; max-width: 560px;
    height: 80vh;
    display: flex; flex-direction: column;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    padding: 12px 14px calc(env(safe-area-inset-bottom, 0px) + 10px);
    box-shadow: 0 -8px 30px rgba(0,0,0,0.5);
  }
  /* Desktop: center the chat as a dialog instead of docking it to the bottom. */
  @media (min-width: 768px) {
    .chat-overlay { align-items: center; }
    .chat-sheet { height: 85vh; border-radius: 16px; margin: auto; }
  }
  /* Match-bets modal: base (mobile) values live here rather than inline so the
     desktop media query can override align-items / border-radius. */
  .match-bets-overlay { align-items: flex-end; }
  .match-bets-sheet { border-radius: 14px 14px 0 0; }
  @media (min-width: 768px) {
    .match-bets-overlay { align-items: center; }
    .match-bets-sheet { border-radius: 14px; }
  }
  .chat-head {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 8px; margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .chat-list {
    flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; gap: 8px;
    padding: 8px 2px;
  }
  .chat-empty { text-align: center; color: var(--text-muted); font-size: 11px; padding: 24px; line-height: 1.6; }
  .chat-input-row { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); flex-shrink: 0; }

  /* Live game in the Calendario: glowing red, like the live score. */
  .cal-live {
    border-color: var(--red) !important;
    animation: calPulse 1.6s ease-in-out infinite;
  }
  @keyframes calPulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(255,77,106,0.35), 0 0 10px rgba(255,77,106,0.25); }
    50%      { box-shadow: 0 0 0 1px rgba(255,77,106,0.6), 0 0 18px rgba(255,77,106,0.5); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cal-live { animation: none; box-shadow: 0 0 0 1px rgba(255,77,106,0.5), 0 0 14px rgba(255,77,106,0.4); }
  }
  .cal-live-dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--red);
    flex-shrink: 0; animation: calDot 1.4s ease-in-out infinite;
  }
  @keyframes calDot {
    0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(255,77,106,0.7); }
    50%      { opacity: 0.45; box-shadow: 0 0 10px rgba(255,77,106,0.95); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cal-live-dot { animation: none; box-shadow: 0 0 6px rgba(255,77,106,0.8); }
  }
  .tab-content-wrapper {
    transition: transform 0.2s ease-out, opacity 0.2s ease-out;
  }
  /* Phones break the Simulador tab out to full viewport width. Once the desktop
     sidebar appears (≥768px) the content box already spans the available width,
     and a 100vw breakout would slide under the fixed sidebar and force a
     body-wide horizontal scrollbar — so reset it there (the simulator's own
     content re-centers at 1400px). */
  .sim-breakout { width: 100vw; margin-left: calc(50% - 50vw); padding: 0 16px; box-sizing: border-box; }
  @media (min-width: 768px) { .sim-breakout { width: auto; margin-left: 0; padding: 0; } }
  .slide-left {
    animation: slideFromRight 0.2s ease-out;
  }
  .slide-right {
    animation: slideFromLeft 0.2s ease-out;
  }
  @keyframes slideFromRight {
    from { transform: translateX(24px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideFromLeft {
    from { transform: translateX(-24px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
