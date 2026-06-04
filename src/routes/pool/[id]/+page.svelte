<script lang="ts">
  import { headerTitle } from '$lib/stores/header';
  import { haptic } from '$lib/haptic';
  import { flagEmoji, shortName } from '$lib/teams.js';
  let { data } = $props();
  let tab = $state(data.deadlinePassed ? 'leaderboard' : 'predictions');
  const tabIndexOrder = ['predictions', 'leaderboard', 'members', 'summary', 'results', 'scoring'];
  let slideDir = $state<'left' | 'right' | ''>('');
  function switchTab(newTab: string) {
    if (newTab === tab) return; // already here — don't replay the slide (the "wiggle")
    haptic(8);
    const oldIdx = tabIndexOrder.indexOf(tab);
    const newIdx = tabIndexOrder.indexOf(newTab);
    slideDir = newIdx > oldIdx ? 'left' : 'right';
    tab = newTab;
  }
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
  // Completeness of the user's primary entry (for the "finish your picks" banner).
  const myCompletion = $derived(data.predictions.length > 0 ? data.completion?.[data.predictions[0].id] : null);
  const groupsDone = $derived(!!myCompletion && myCompletion.groups >= myCompletion.groupsTotal);
  const predComplete = $derived(!!myCompletion && groupsDone && myCompletion.bracketDone && myCompletion.tiebreakerDone);

  const paidCount = $derived(data.members.filter((m: any) => m.has_paid).length);
  const memberCount = $derived(data.members.length);
  const pot = $derived((Number(pool.buy_in) || 0) * paidCount);
  const curSymbol = ({ EUR: '€', USD: '$', GBP: '£' } as Record<string, string>)[pool.currency] ?? '';
  const fmtMoney = (n: number) => curSymbol ? `${n.toFixed(2)}${curSymbol}` : `${n.toFixed(2)} ${pool.currency || ''}`.trim();

  $effect(() => {
    headerTitle.set({ text: pool.name, emoji: pool.emoji || '🏆', showBack: false, poolName: pool.name, poolEmoji: pool.emoji || '🏆' });
    return () => { headerTitle.set({ text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null }); };
  });

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

  const tabs = [
    { id: 'predictions', label: 'Pronósticos' },
    { id: 'leaderboard', label: 'Clasificación' },
    { id: 'members', label: 'Miembros' },
    { id: 'summary', label: '📋 Resumen' },
    { id: 'results', label: '🏆 Resultados' },
    { id: 'scoring', label: 'Puntuación' },
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

<div style="flex: 1; display: flex; flex-direction: column;">
  <!-- Sticky Back Link -->
  <div style="position: sticky; top: 0; z-index: 10; background: var(--bg-base); padding: 8px 0; margin-bottom: 8px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
    <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; text-decoration: none;">← Quinielas</a>
    <span style="color: var(--border); font-size: 10px;">/</span>
    <span style="font-size: 10px; color: var(--gold);">{pool.name}</span>
  </div>

  <!-- Content -->
  <div style="flex: 1; display: flex; flex-direction: column;">

  <!-- Pool Header -->
  <div style="margin-bottom: 24px; padding: 24px; background: linear-gradient(135deg, rgba(201,168,76,0.08) 0%, transparent 100%); border-radius: 16px; border: 1px solid rgba(201,168,76,0.12);">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
      <div>
        <h1 style="font-family: 'Libre Baskerville', serif; font-size: 24px; color: var(--gold); margin-bottom: 8px;">{pool.name}</h1>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: var(--text-muted);">
          <span>👥 {data.members.length} miembros</span>
          {#if pool.buy_in > 0}
            <span>💰 {fmtMoney(Number(pool.buy_in) || 0)} entrada</span>
            {#if pot > 0}
              <span style="color: var(--gold);">🏆 Bote: {fmtMoney(pot)}</span>
            {/if}
          {/if}
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <span style="font-size: 10px; color: var(--text-muted);">🔗 <span style="color: var(--gold); font-weight: 600;">{pool.invite_code}</span></span>
        <button onclick={openSheet} style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 14px; color: var(--text-muted); cursor: pointer; line-height: 1;">⋯</button>
      </div>
    </div>
  </div>

  <!-- Payment-pending banner (money pools, current user not yet marked paid) -->
  {#if owesBuyIn}
    <div style="margin-bottom: 16px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; background: rgba(201,168,76,0.08); border: 1px solid var(--gold); border-radius: 10px;">
      <span style="font-size: 18px;">💰</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; font-weight: 600; color: var(--gold);">Entrada pendiente de pago</div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px; line-height: 1.4;">
          Aún no se ha registrado tu pago de <strong>{pool.buy_in}€</strong>. Paga al organizador; te marcará como pagado. Tus pronósticos cuentan igualmente.
        </div>
      </div>
    </div>
  {/if}

  <!-- Prediction-completeness banner (only once the user has started an entry) -->
  {#if myCompletion}
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
      >{t.label}</button>
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

      <!-- Your position card -->
      {#if myEntry && data.leaderboard.length > 5}
        <div style="background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.25); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; cursor: pointer;" onclick={() => document.getElementById('my-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="font-size: 22px; font-weight: 800; color: var(--gold);">{myIndex + 1}º</div>
              <div>
                <div style="font-size: 12px; font-weight: 600; color: var(--gold);">Tu posición</div>
                <div style="font-size: 10px; color: var(--text-muted);">{myEntry.total_score} pts</div>
              </div>
            </div>
            <div style="text-align: right;">
              {#if prevEntry}
                <div style="font-size: 9px; color: var(--text-muted);">
                  {prevEntry.total_score - myEntry.total_score > 0 ? `${prevEntry.total_score - myEntry.total_score} pts para ${myIndex}º` : `¡empatado con ${myIndex}º!`}
                </div>
              {/if}
              {#if data.leaderboard.length > 3}
                <div style="font-size: 8px; color: var(--text-dim); margin-top: 2px;">toca para ir</div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Share scoreboard button -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 4px;">
        <button onclick={() => { shareScoreboard(); haptic(10); }} style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: {shared ? 'var(--green)' : 'var(--text-muted)'}; cursor: pointer;">
          {shared ? '✓ Enlace copiado' : '🔗 Compartir clasificación'}
        </button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        {#each data.leaderboard as entry, i}
          <div id={entry.user_id === data.userId ? 'my-row' : ''} class="leaderboard-row" style="display: flex; align-items: center; gap: 12px; background: {entry.user_id === data.userId ? 'rgba(201,168,76,0.08)' : 'var(--bg-card)'}; border: 1px solid {entry.user_id === data.userId ? 'var(--gold)' : i === 0 ? 'rgba(201,168,76,0.2)' : 'var(--border)'}; border-radius: 8px; padding: 12px 16px; {entry.user_id === data.userId ? 'box-shadow: 0 0 12px rgba(201,168,76,0.15);' : i === 0 ? 'box-shadow: 0 0 16px rgba(201,168,76,0.1);' : ''}">
            <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; {i === 0 ? 'background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e;' : i === 1 ? 'background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e;' : i === 2 ? 'background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e;' : 'background: rgba(255,255,255,0.06); color: var(--text-dim);'} flex-shrink: 0;">
              {entry.display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 13px; font-weight: 600; {entry.user_id === data.userId ? 'color: var(--gold);' : ''}">{i + 1}. {entry.display_name}{entry.label ? ` (${entry.label})` : ''}</div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
                {#if entry.group_correct > 0}
                  <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 3px;">Grupos: {entry.group_correct}</span>
                {/if}
                {#each Object.entries(entry.bracket_correct || {}) as [phase, count]}
                  <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 3px;">{phaseLabels[phase] || phase}: {count}</span>
                {/each}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 18px; font-weight: 700; color: var(--gold);">{entry.total_score}</div>
              <div style="font-size: 9px; color: var(--text-muted);">pts</div>
            </div>
          </div>
        {/each}
      </div>
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
          {/if}
        </div>
        <p style="font-size: 9px; color: var(--text-dim); margin-top: 8px; line-height: 1.5;">Hasta <strong>{6 * n('match_outcome')} pts</strong> por grupo (6 partidos) · <strong>{72 * n('match_outcome')}</strong> en total.</p>
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
    <div style="max-width: 500px; margin: 0 auto;">
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
          {#each groupPreds as gp}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 6px;">
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
    <div style="max-width: 600px; margin: 0 auto;">
      {#if data.predictions.length > 0}
        {@const totalUserPoints = data.userGroupPredsFull.reduce((sum: number, g: any) => sum + (g.points_earned || 0), 0) + data.userBracketPredsFull.reduce((sum: number, b: any) => sum + (b.points_earned || 0), 0)}
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
              {#each Object.entries(data.resultsGroupStandings).sort(([a], [b]) => a.localeCompare(b)) as [group, teams]}
                {@const predicted = groupPredLookup[group]}
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
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
              {#if Object.keys(data.resultsGroupStandings).length === 0}
                <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No hay resultados de fase de grupos todavía.</p>
              {/if}
            {:else}
              {#each matches as match, mi}
                {@const pred = bracketLookup[phase]?.[mi]}
                {@const isFinished = match.status === 'finished'}
                {@const homeWin = isFinished && match.home_score > match.away_score}
                {@const awayWin = isFinished && match.away_score > match.home_score}
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
                    Tu predicción: {getTeamFlag(pred.team_id)} {getTeamName(pred.team_id)}
                    {#if correct}<span style="color: var(--green);"> ✓ +{pred.points_earned}pts</span>{:else}<span style="color: var(--red);"> ✗</span>{/if}
                  </div>
                {/if}
              {/each}
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

<style>
  .tab-content-wrapper {
    transition: transform 0.2s ease-out, opacity 0.2s ease-out;
  }
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
