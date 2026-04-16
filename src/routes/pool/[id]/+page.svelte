<script lang="ts">
  let { data } = $props();
  let tab = $state('leaderboard');
  let copied = $state(false);

  const pool = data.pool;

  const tabs = [
    { id: 'leaderboard', label: 'Clasificación' },
    { id: 'predictions', label: 'Pronósticos' },
    { id: 'bracket', label: 'Eliminatorias' },
    { id: 'members', label: 'Miembros' },
    { id: 'summary', label: '📋 Resumen', link: true },
    { id: 'results', label: '🏆 Resultados', link: true },
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

  function copyCode() {
    const url = `${window.location.origin}/join/${pool.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    });
  }
</script>

<div>
  <!-- Sticky Back Link -->
  <div style="position: sticky; top: 0; z-index: 10; background: var(--bg-base); padding: 8px 0; margin-bottom: 8px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px;">
    <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; text-decoration: none;">← Quinielas</a>
    <span style="color: var(--border); font-size: 10px;">/</span>
    <span style="font-size: 10px; color: var(--gold);">{pool.name}</span>
  </div>

  <!-- Pool Header -->
  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 24px; color: var(--gold);">{pool.name}</h1>
    <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 11px; color: var(--text-muted);">
      <span>👥 {data.members.length} miembros</span>
      {#if pool.buy_in > 0}
        <span>💰 {pool.buy_in}€ entrada</span>
      {/if}
      <span>🔗 Código: <span style="color: var(--gold); font-weight: 600;">{pool.invite_code}</span></span>
      <button onclick={copyCode} style="background: none; border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 9px; color: {copied ? 'var(--green)' : 'var(--text-muted)'}; cursor: pointer; transition: all 0.2s;">
        {copied ? '✓ Enlace copiado' : 'Compartir enlace'}
      </button>
    </div>
    {#if data.isAdmin}
      <div style="margin-top: 8px;">
        <a href="/pool/{pool.id}/admin" class="btn-ghost" style="font-size: 9px; padding: 6px 14px;">⚙️ Administración</a>
      </div>
    {/if}
  </div>

  <!-- Tabs -->
  <div style="display: flex; gap: 0; margin-bottom: 20px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
    {#each tabs as t, i}
      {#if t.link}
        <a href="/pool/{pool.id}/{t.id}" style="flex: 1; padding: 10px 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; text-align: center; display: block; line-height: 1.4; background: transparent; color: var(--text-muted); {i > 0 ? 'border-left: 1px solid var(--border);' : ''}">{t.label}</a>
      {:else}
        <button
          onclick={() => tab = t.id}
          style="flex: 1; padding: 10px 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; border: none; background: {tab === t.id ? 'rgba(201,168,76,0.1)' : 'transparent'}; color: {tab === t.id ? 'var(--gold)' : 'var(--text-muted)'}; {i > 0 ? 'border-left: 1px solid var(--border);' : ''}"
        >{t.label}</button>
      {/if}
    {/each}
  </div>

  <!-- Clasificación -->
  {#if tab === 'leaderboard'}
    {#if data.leaderboard.length === 0}
      <div style="text-align: center; padding: 32px; color: var(--text-muted); font-size: 12px;">
        Sin pronósticos aún. <a href="/pool/{pool.id}/predict" style="color: var(--gold);">¡Predice ahora!</a>
      </div>
    {:else}
      <div style="display: flex; flex-direction: column; gap: 8px;">
        {#each data.leaderboard as entry, i}
          <div class="leaderboard-row" style="display: flex; align-items: center; gap: 12px; background: {entry.user_id === data.userId ? 'rgba(201,168,76,0.08)' : 'var(--bg-card)'}; border: 1px solid {entry.user_id === data.userId ? 'var(--gold)' : 'var(--border)'}; border-radius: 8px; padding: 14px 16px; {entry.user_id === data.userId ? 'box-shadow: 0 0 12px rgba(201,168,76,0.15);' : ''}">
            <div style="width: 28px; text-align: center; font-weight: 700; font-size: 16px; color: {i === 0 ? 'var(--gold)' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--text-dim)'};">
              {#if i === 0}🏆{:else}{i + 1}{/if}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 13px; font-weight: 600; {entry.user_id === data.userId ? 'color: var(--gold);' : ''}">{entry.display_name}{entry.label ? ` (${entry.label})` : ''}</div>
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
              <div style="font-size: 16px; font-weight: 700; color: var(--gold);">{entry.total_score}</div>
              <div style="font-size: 9px; color: var(--text-muted);">puntos</div>
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
        <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">
          <a href="/pool/{pool.id}/predict" class="btn-primary" style="font-size: 11px; padding: 10px 24px;">📋 Paso 1: Pronosticar Grupos</a>
        </div>
      </div>
    {:else}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;">Mis Pronósticos</h3>
        <a href="/pool/{pool.id}/predict" class="btn-ghost" style="font-size: 9px; padding: 6px 14px;">Editar grupos</a>
      </div>
      {#each data.predictions as pred}
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px;">{pred.label || 'Apuesta principal'}</span>
            <span style="font-size: 12px; color: var(--gold); font-weight: 600;">{pred.total_score} pts</span>
          </div>
          <div style="margin-top: 8px;">
            <a href="/pool/{pool.id}/bracket" style="font-size: 10px; color: var(--gold);">Ver cuadro eliminatorio →</a>
          </div>
        </div>
      {/each}
    {/if}
  {/if}

  <!-- Eliminatorias Tab -->
  {#if tab === 'bracket'}
    <div style="text-align: center; padding: 24px;">
      <div style="font-size: 32px; margin-bottom: 8px;">🏆</div>
      <h3 style="font-size: 14px; color: var(--gold); margin-bottom: 8px;">Cuadro Eliminatorio</h3>
      <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Paso 1: Rellena los grupos. Paso 2: Elige los ganadores de cada eliminatoria.</p>
      
      {#if data.predictions.length === 0}
        <div style="background: rgba(255,77,106,0.08); border: 1px solid var(--red); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--red); margin-bottom: 8px;">⚠️ Primero necesitas crear tus pronósticos</div>
          <a href="/pool/{pool.id}/predict" class="btn-primary" style="font-size: 10px; padding: 8px 20px;">Pronosticar Grupos →</a>
        </div>
      {:else}
        <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
          <a href="/pool/{pool.id}/predict" class="btn-ghost" style="font-size: 10px; padding: 8px 16px;">📋 Fase de Grupos</a>
          <a href="/pool/{pool.id}/bracket" class="btn-primary" style="font-size: 10px; padding: 8px 20px;">🏆 Cuadro Eliminatorio →</a>
        </div>
      {/if}
    </div>
  {/if}


  <!-- Members Tab -->
  {#if tab === 'members'}
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
</div>
