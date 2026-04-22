<script lang="ts">
  let { data } = $props();
  let tab = $state(data.deadlinePassed ? 'leaderboard' : 'predictions');
  let copied = $state(false);
  let summaryEntry = $state(data.predictions.length > 0 ? data.predictions[0].id : null);

  const pool = data.pool;

  const phaseOrder = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  function flag(code: string) {
    if (!code) return '';
    return code.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
  }
  function teamName(id: number) { return data.teams[id]?.name || 'TBD'; }
  function teamFlag(id: number) { return flag(data.teams[id]?.flag_code || ''); }

  function getGroupPreds() {
    if (!summaryEntry) return [];
    return data.groupPreds[summaryEntry] || [];
  }
  function getBracketPreds() {
    if (!summaryEntry) return {};
    const raw = data.bracketPreds[summaryEntry] || [];
    const grouped: Record<string, any[]> = {};
    for (const b of raw) {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    }
    return grouped;
  }

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

  function getTeamName(id: number) { return data.resultsTeamCache[id]?.name || 'TBD'; }
  function getTeamFlag(id: number) { return flag(data.resultsTeamCache[id]?.flag_code || ''); }
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

  const scoringLabels: Record<string, string> = {
    exact_score: 'Resultado exacto (fase de grupos)',
    match_outcome: 'Resultado correcto (ganar/empatar/perder)',
    group_position: 'Posición en grupo',
    knockout_r32: 'Dieciseisavos — acierto',
    knockout_r16: 'Octavos — acierto',
    knockout_qf: 'Cuartos — acierto',
    knockout_sf: 'Semifinales — acierto',
    knockout_final: 'Final — acierto',
    third_place: '3er puesto — acierto',
    knockout_winner: 'Ganador eliminatoria',
    r32_winner: 'Ganador dieciseisavos',
    r16_winner: 'Ganador octavos',
    qf_winner: 'Ganador cuartos',
    sf_winner: 'Ganador semifinales',
    final_winner: 'Ganador del mundial',
    final_exact_score: 'Resultado exacto final',
  };

  let shared = $state(false);

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
    const url = `${window.location.origin}/s/${pool.invite_code}`;
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
            <span>💰 {pool.buy_in}€ entrada</span>
            {#if pool.prize_pool > 0}
              <span style="color: var(--gold);">🏆 Bote: {pool.prize_pool}€</span>
            {/if}
          {/if}
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <span style="font-size: 10px; color: var(--text-muted);">🔗 <span style="color: var(--gold); font-weight: 600;">{pool.invite_code}</span></span>
        <button onclick={copyCode} style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: {copied ? 'var(--green)' : 'var(--text-muted)'}; cursor: pointer; transition: all 0.2s;">
          {copied ? '✓ Copiado' : 'Compartir enlace'}
        </button>
        {#if data.isAdmin}
          <a href="/pool/{pool.id}/admin" class="btn-ghost" style="font-size: 9px; padding: 6px 14px; text-decoration: none;">⚙️ Admin</a>
        {/if}
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="pool-tabs">
    {#each tabs as t, i}
      {#if t.link}
        <a href="/pool/{pool.id}/{t.id}" class="pool-tab" class:active={false}>{t.label}</a>
      {:else}
        <button
          onclick={() => tab = t.id}
          class="pool-tab"
          class:active={tab === t.id}
        >{t.label}</button>
      {/if}
    {/each}
  </div>

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
        <button onclick={shareScoreboard} style="background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 10px; color: {shared ? 'var(--green)' : 'var(--text-muted)'}; cursor: pointer;">
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
        <div style="font-size: 40px; margin-bottom: 12px;">⚽</div>
        <h3 style="font-size: 16px; color: var(--gold); margin-bottom: 8px;">¡Empieza a predecir!</h3>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 20px;">Rellena los resultados de cada grupo y luego el cuadro eliminatorio.</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 320px;">
          <a href="/pool/{pool.id}/predict" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
            <span style="font-size: 24px;">📋</span>
            <span style="font-size: 12px; font-weight: 600; color: var(--text);">Fase de Grupos</span>
            <span style="font-size: 9px; color: var(--text-muted);">Predice 1º 2º 3º 4º</span>
          </a>
          <a href="/pool/{pool.id}/bracket" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
            <span style="font-size: 24px;">⚔️</span>
            <span style="font-size: 12px; font-weight: 600; color: var(--text);">Eliminatorias</span>
            <span style="font-size: 9px; color: var(--text-muted);">Cuadro completo</span>
          </a>
        </div>
      </div>
    {:else}
      {#each data.predictions as pred}
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 8px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
            <a href="/pool/{pool.id}/predict" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px; background: rgba(232,201,106,0.06); border: 1px solid rgba(232,201,106,0.15); border-radius: 8px; text-decoration: none;">
              <span style="font-size: 24px;">📋</span>
              <span style="font-size: 12px; font-weight: 600; color: var(--text);">Fase de Grupos</span>
              <span style="font-size: 9px; color: var(--text-muted);">Predice 1º 2º 3º 4º</span>
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

  <!-- Scoring Tab -->
  {#if tab === 'scoring'}
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each Object.entries(data.scoring) as [rule, points]}
        <div style="display: flex; justify-content: space-between; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;">
          <span style="font-size: 12px; color: var(--text);">{scoringLabels[rule] || rule.replace(/_/g, ' ')}</span>
          <span style="font-size: 12px; font-weight: 600; color: var(--gold);">{points} pts</span>
        </div>
      {/each}
    </div>
    <p style="font-size: 10px; color: var(--text-dim); margin-top: 12px; text-align: center;">Puntuación configurada por el creador de la quiniela.</p>
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
                <option value={pred.id}>{pred.label || 'Entrada ' + pred.id}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Group predictions -->
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">🏆 Fase de Grupos</h2>
          {#each getGroupPreds() as gp}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 6px;">
              <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Grupo {gp.group_name}</div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                {#each [gp.position_1, gp.position_2, gp.position_3, gp.position_4] as tid, idx}
                  {#if tid}
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; {idx < 2 ? 'color: var(--text); font-weight: 500;' : 'color: var(--text-muted);'}">
                      <span style="width: 14px; font-size: 9px; color: var(--text-muted);">{idx + 1}.</span>
                      <span>{teamFlag(tid)}</span>
                      <span>{teamName(tid)}</span>
                    </div>
                  {:else}
                    <div style="font-size: 11px; color: var(--text-muted); opacity: 0.5;">{idx + 1}. —</div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
          {#if getGroupPreds().length === 0}
            <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No has predicho grupos aún.</p>
          {/if}
        </div>

        <!-- Bracket predictions -->
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px;">⚔️ Eliminatorias</h2>
          {#each phaseOrder as phase}
            {@const bracketPreds = getBracketPreds()}
            {@const picks = bracketPreds[phase]}
            {#if picks && picks.length > 0}
              <div style="margin-bottom: 12px;">
                <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">{phaseLabels[phase] || phase}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  {#each picks as pick}
                    <span style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 11px;">
                      {teamFlag(pick.team_id)} {teamName(pick.team_id)}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
          {#if Object.keys(getBracketPreds()).length === 0}
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
                        <td style="padding: 4px;">{flag(team.flag_code)} {team.name}</td>
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
                  <span style="flex: 1; text-align: right; font-size: 12px; {homeWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">{flag(match.home_flag)} {match.home_name ?? 'TBD'}</span>
                  <div style="min-width: 56px; text-align: center;">
                    {#if isFinished}
                      <span style="font-size: 14px; font-weight: 700; color: var(--gold);">{match.home_score} - {match.away_score}</span>
                    {:else}
                      <span style="font-size: 9px; color: var(--text-muted);">Pend.</span>
                    {/if}
                  </div>
                  <span style="flex: 1; text-align: left; font-size: 12px; {awayWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">{match.away_name ?? 'TBD'} {flag(match.away_flag)}</span>
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
