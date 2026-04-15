<script>
  let { data } = $props();
  let version = $state(0);
  let _scoring = { ...data.scoring };
  let scoring = $derived.by(() => { void version; return { ..._scoring }; });
  let _members = [...data.members];
  let members = $derived.by(() => { void version; return [..._members]; });
  let saving = $state(false);
  let message = $state('');

  const pool = data.pool;

  const ruleLabels = {
    match_outcome: 'Resultado partido',
    exact_score: 'Resultado exacto',
    group_position: 'Posición en grupo',
    knockout_r32: 'Octavos (R32)',
    knockout_r16: 'Octavos de final',
    knockout_qf: 'Cuartos de final',
    knockout_sf: 'Semifinal',
    knockout_final: 'Final',
    knockout_winner: 'Campeón',
    final_exact_score: 'Resultado exacto final',
    r32_winner: 'R32 Ganador',
    r16_winner: 'Octavos Ganador',
    qf_winner: 'Cuartos Ganador',
    sf_winner: 'Semifinal Ganador',
    final_winner: 'Final Ganador',
    third_place: '3er lugar',
  };

  function label(rule) {
    return ruleLabels[rule] ?? rule.replace(/_/g, ' ');
  }

  async function saveScoring() {
    saving = true;
    message = '';
    const res = await fetch('/api/admin/scoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pool_id: pool.id, rules: _scoring }),
    });
    saving = false;
    if (res.ok) { message = '✓ Guardado'; setTimeout(() => message = '', 2000); }
    else { message = '✗ Error al guardar'; }
  }

  async function togglePaid(userId, current) {
    const res = await fetch('/api/admin/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pool_id: pool.id, user_id: userId, has_paid: !current }),
    });
    if (res.ok) {
      _members = _members.map(m => m.id === userId ? { ...m, has_paid: !current ? 1 : 0 } : m);
      version++;
    }
  }
</script>

<svelte:head>
  <title>Admin - {pool.name}</title>
</svelte:head>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Volver al pool</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">⚙️ Admin</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 20px;">{pool.name}</p>

  <!-- Stats -->
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; margin-bottom: 24px;">
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center;">
      <div style="font-size: 18px; font-weight: 700; color: var(--gold);">{data.stats.totalMembers}</div>
      <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Miembros</div>
    </div>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center;">
      <div style="font-size: 18px; font-weight: 700; color: var(--green);">{data.stats.totalPaid}/{data.stats.totalMembers}</div>
      <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Pagado</div>
    </div>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center;">
      <div style="font-size: 18px; font-weight: 700; color: var(--blue);">{data.stats.totalPredictions}</div>
      <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Predicciones</div>
    </div>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center;">
      <div style="font-size: 18px; font-weight: 700;">{data.stats.finishedMatches}/{data.stats.totalMatches}</div>
      <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;">Partidos</div>
    </div>
  </div>

  <!-- Scoring Config -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Puntuación</h2>
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each Object.entries(scoring) as [rule, points]}
        <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px;">
          <span style="flex: 1; font-size: 11px; color: var(--text-muted);">{label(rule)}</span>
          <input
            type="number"
            min="0"
            value={points}
            onchange={(e) => { _scoring[rule] = Number(e.target.value); version++; }}
            style="width: 60px; text-align: center; padding: 4px 6px; font-size: 12px;"
          />
          <span style="font-size: 9px; color: var(--text-dim);">pts</span>
        </div>
      {/each}
    </div>
    <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
      <button class="btn-primary" onclick={saveScoring} disabled={saving} style="font-size: 9px; padding: 8px 16px;">
        {saving ? 'Guardando...' : 'Guardar puntuación'}
      </button>
      {#if message}
        <span style="font-size: 11px; color: var(--green);">{message}</span>
      {/if}
    </div>
  </div>

  <!-- Members & Payment -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Miembros</h2>
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each members as member}
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
          <span style="font-size: 12px;">{member.display_name}</span>
          {#if pool.buy_in > 0}
            <button
              onclick={() => togglePaid(member.id, member.has_paid)}
              style="font-size: 9px; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid {member.has_paid ? 'var(--green)' : 'var(--red)'}; background: {member.has_paid ? 'rgba(0,229,160,0.1)' : 'rgba(255,77,106,0.1)'}; color: {member.has_paid ? 'var(--green)' : 'var(--red)'}; cursor: pointer;"
            >
              {member.has_paid ? '✓ Pagado' : '✗ Pendiente'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Match Results -->
  <div>
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Resultados de partidos</h2>
    {#if data.matches.length === 0}
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px;">
        No hay partidos de grupo configurados aún.
      </div>
    {:else}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        {#each data.matches as match}
          {@const isFinished = match.status === 'finished'}
          <div style="display: flex; align-items: center; gap: 6px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 11px;">
            <span style="width: 20px; color: var(--text-dim); font-size: 9px; text-transform: uppercase;">{match.group_name}</span>
            <span style="flex: 1; {isFinished ? '' : 'color: var(--text-muted);'}">{match.home_name ?? 'TBD'}</span>
            <input
              type="number"
              min="0"
              value={match.home_score ?? ''}
              placeholder="-"
              data-match-id={match.id}
              data-side="home"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="color: var(--text-dim);">-</span>
            <input
              type="number"
              min="0"
              value={match.away_score ?? ''}
              placeholder="-"
              data-match-id={match.id}
              data-side="away"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="flex: 1; text-align: right; {isFinished ? '' : 'color: var(--text-muted);'}">{match.away_name ?? 'TBD'}</span>
            <button type="submit" class="btn-primary"
      style="font-size: 8px; padding: 4px 8px;"
      onclick={async () => {
        const row = document.querySelector(`[data-match-id="${match.id}"][data-side="home"]`);
        const row2 = document.querySelector(`[data-match-id="${match.id}"][data-side="away"]`);
        const hs = Number(row?.value);
        const as2 = Number(row2?.value);
        if (isNaN(hs) || isNaN(as2)) return;
        const res = await fetch('/api/admin/results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ match_id: match.id, home_score: hs, away_score: as2 }),
        });
        if (res.ok) { match.status = 'finished'; match.home_score = hs; match.away_score = as2; }
      }}
    >Guardar</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
