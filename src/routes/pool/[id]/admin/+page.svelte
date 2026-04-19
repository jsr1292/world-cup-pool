<script>
  let { data } = $props();
  let version = $state(0);
  let _scoring = { ...data.scoring };
  let scoring = $derived.by(() => { void version; return { ..._scoring }; });
  let _members = [...data.members];
  let members = $derived.by(() => { void version; return [..._members]; });
  let saving = $state(false);
  let message = $state('');
  let recalcMsg = $state('');
  let backupMsg = $state('');
  let memberSearch = $state('');

  const filteredMembers = $derived(
    memberSearch.length < 1 ? members
      : members.filter(m => m.display_name.toLowerCase().includes(memberSearch.toLowerCase()))
  );

  const pool = data.pool;

  const prizeSplits = [
    { label: '1er puesto', pct: 0.6 },
    { label: '2do puesto', pct: 0.25 },
    { label: '3er puesto', pct: 0.15 },
  ];
  let totalPool = $derived((pool.buy_in || 0) * data.stats.totalPaid);

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

  // Deadline state
  let deadlineGroup = $state(pool.deadline_group ? pool.deadline_group.slice(0, 16) : '');
  let deadlineKnockout = $state(pool.deadline_knockout ? pool.deadline_knockout.slice(0, 16) : '');
  let savingDeadline = $state(false);
  let deadlineMsg = $state('');

  // Multiple predictions setting
  let allowMultiple = $state(pool.allow_multiple_predictions === 1);
  let savingSettings = $state(false);
  let settingsMsg = $state('');

  async function saveSettings() {
    savingSettings = true;
    settingsMsg = '';
    try {
      const res = await fetch('/api/admin/pool-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: pool.id, allow_multiple_predictions: allowMultiple }),
      });
      if (res.ok) { settingsMsg = '✓ Guardado'; setTimeout(() => settingsMsg = '', 2000); }
      else { const d = await res.json(); settingsMsg = d.error || '✗ Error'; }
    } catch { settingsMsg = '✗ Error'; }
    savingSettings = false;
  }

  async function saveDeadlines() {
    savingDeadline = true;
    deadlineMsg = '';
    try {
      const res = await fetch('/api/admin/scoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pool_id: pool.id,
          deadline_group: deadlineGroup || null,
          deadline_knockout: deadlineKnockout || null,
        }),
      });
      if (res.ok) { deadlineMsg = '✓ Fechas guardadas'; setTimeout(() => deadlineMsg = '', 2000); }
      else { deadlineMsg = '✗ Error'; }
    } catch { deadlineMsg = '✗ Error'; }
    savingDeadline = false;
  }

  let showConfirm = $state(false);
  let confirmEntryId = $state(null);
  let confirmOdUserId = $state(null);
  let confirmDisplayName = $state('');

  async function togglePaid(entryId, current, displayName, odUserId) {
    // Confirmation dialog for unchecking paid status
    if (current) {
      showConfirm = true;
      confirmEntryId = entryId;
      confirmDisplayName = displayName;
      confirmOdUserId = odUserId;
      return;
    }
    await doTogglePaid(entryId, !current, odUserId);
  }

  async function doTogglePaid(entryId, newValue, odUserId) {
    showConfirm = false;
    confirmEntryId = null;
    confirmOdUserId = null;
    confirmDisplayName = '';
    const res = await fetch('/api/admin/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool_id: pool.id,
        entry_id: entryId || undefined,
        user_id: odUserId || undefined,
        has_paid: newValue
      }),
    });
    if (res.ok) {
      if (entryId) {
        _members = _members.map(m => m.entry_id === entryId ? { ...m, has_paid: newValue ? 1 : 0 } : m);
      } else {
        _members = _members.map(m => m.od_user_id === odUserId ? { ...m, has_paid: newValue ? 1 : 0 } : m);
      }
      version++;
    }
  }
</script>

<svelte:head>
  <title>Administración · {pool.name}</title>
</svelte:head>

<div>
  <a href="/pool/{pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Volver al pool</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">⚙️ Administración</h1>
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

  <!-- Prize Distribution -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">💰 Reparto de Premios</h2>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 14px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <span style="font-size: 11px; color: var(--text-muted);">Bote total:</span>
        <span style="font-size: 18px; font-weight: 700; color: var(--gold);">{totalPool > 0 ? totalPool.toFixed(2) + '€' : '—'}</span>
        <span style="font-size: 10px; color: var(--text-muted);">({data.stats.totalPaid} pagados × {pool.buy_in || 0}€)</span>
      </div>

      {#if totalPool > 0}
        <div style="display: flex; flex-direction: column; gap: 6px;">
          {#each prizeSplits as split}
            {@const amount = totalPool * split.pct}
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg-surface); border-radius: 4px;">
              <span style="font-size: 11px; color: var(--text);">{split.label}</span>
              <div>
                <span style="font-size: 12px; font-weight: 600; color: var(--gold);">{amount.toFixed(2)}€</span>
                <span style="font-size: 9px; color: var(--text-muted); margin-left: 4px;">({(split.pct * 100).toFixed(0)}%)</span>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p style="font-size: 10px; color: var(--text-muted);">Configura la cuota de entrada y marca miembros como pagados para ver el reparto.</p>
      {/if}
    </div>
  </div>

  <!-- Pool Settings -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Configuración</h2>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 14px;">
      <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
        <input type="checkbox" bind:checked={allowMultiple} style="margin-top: 2px; width: 14px; height: 14px; accent-color: var(--gold);" />
        <div>
          <div style="font-size: 12px; color: var(--text); font-weight: 500;">Múltiples apuestas por usuario</div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Permite que cada usuario cree varias entradas con predicciones independientes en la misma quiniela.</div>
        </div>
      </label>
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px;">
        <button onclick={saveSettings} disabled={savingSettings} class="btn-primary" style="font-size: 9px; padding: 8px 16px;">
          {savingSettings ? 'Guardando...' : 'Guardar'}
        </button>
        {#if settingsMsg}
          <span style="font-size: 11px; color: {settingsMsg.includes('✓') ? 'var(--green)' : 'var(--red)'};">{settingsMsg}</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Deadlines -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Fechas límite</h2>
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
      <div>
        <label style="display: block; font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px;">Fase de grupos</label>
        <input type="datetime-local" bind:value={deadlineGroup} style="font-size: 12px; padding: 6px 8px;" />
      </div>
      <div>
        <label style="display: block; font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px;">Eliminatorias</label>
        <input type="datetime-local" bind:value={deadlineKnockout} style="font-size: 12px; padding: 6px 8px;" />
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-primary" onclick={saveDeadlines} disabled={savingDeadline} style="font-size: 9px; padding: 8px 16px;">
          {savingDeadline ? 'Guardando...' : 'Guardar fechas'}
        </button>
        {#if deadlineMsg}
          <span style="font-size: 11px; color: var(--green);">{deadlineMsg}</span>
        {/if}
      </div>
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

    <!-- Recalculate Scores -->
    <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px;">
      <button class="btn-ghost" onclick={async () => {
        recalcMsg = 'Calculando...';
        try {
          const res = await fetch('/api/admin/recalculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pool_id: pool.id }),
          });
          if (res.ok) { recalcMsg = '✓ Puntuaciones recalculadas'; setTimeout(() => recalcMsg = '', 3000); }
          else { recalcMsg = '✗ Error'; }
        } catch { recalcMsg = '✗ Error'; }
      }} style="font-size: 9px; padding: 8px 16px;">
        🔄 Recalcular puntuaciones
      </button>
      {#if recalcMsg}
        <span style="font-size: 11px; color: {recalcMsg.startsWith('✓') ? 'var(--green)' : 'var(--text-muted)'};">{recalcMsg}</span>
      {/if}
      <button class="btn-ghost" onclick={async () => {
        backupMsg = 'Guardando...';
        try {
          const res = await fetch('/api/admin/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'admin' }),
          });
          if (res.ok) { backupMsg = '✓ Backup creado'; setTimeout(() => backupMsg = '', 3000); }
          else { backupMsg = '✗ Error'; }
        } catch { backupMsg = '✗ Error'; }
      }} style="font-size: 9px; padding: 8px 16px;">
        💾 Crear backup
      </button>
      {#if backupMsg}
        <span style="font-size: 11px; color: {backupMsg.startsWith('✓') ? 'var(--green)' : 'var(--text-muted)'};">{backupMsg}</span>
      {/if}
    </div>
  </div>

  <!-- Members & Payment -->
  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">Miembros</h2>
    <input
      type="text"
      placeholder="🔍 Buscar miembro..."
      bind:value={memberSearch}
      style="width: 100%; padding: 8px 12px; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); margin-bottom: 8px;"
    />
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each filteredMembers as member}
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
          <span style="font-size: 12px;">{member.display_name}</span>
          {#if pool.buy_in > 0}
            <button
              onclick={() => togglePaid(member.entry_id, member.has_paid, member.display_name, member.od_user_id)}
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
    <div style="margin-bottom: 10px; display: flex; gap: 8px; align-items: center;">
      <button class="btn-ghost" onclick={async () => {
        try {
          const res = await fetch('/api/admin/fifa-sync', { method: 'POST' });
          const data = await res.json();
          if (res.ok) alert(`Sincronizado: ${data.updated ?? 0} partidos actualizados`);
          else alert('Error: ' + (data.error ?? 'desconocido'));
        } catch { alert('Error de conexión'); }
      }} style="font-size: 9px; padding: 8px 16px;">📡 Sincronizar con FIFA</button>
      <span style="font-size: 9px; color: var(--text-dim);">Actualiza resultados automáticamente desde FIFA</span>
    </div>
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
          body: JSON.stringify({ pool_id: pool.id, match_id: match.id, home_score: hs, away_score: as2 }),
        });
        if (res.ok) { match.status = 'finished'; match.home_score = hs; match.away_score = as2; }
      }}
    >Guardar</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>  {#if showConfirm}
    <div style="position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);"
      role="dialog"
      aria-modal="true"
    >
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 24px; max-width: 320px; width: 90%;"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Escape') { showConfirm = false; confirmEntryId = null; confirmOdUserId = null; confirmDisplayName = ''; } }}
      >
        <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px;">⚠️ Confirmar cambio de pago</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5;">
          ¿Marcar como <strong style="color: var(--red);">no pagado</strong> a <strong style="color: var(--text);">{confirmDisplayName}{confirmEntryId ? ' (entrada)' : ' (sin entrada)'}</strong>?
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button onclick={() => { showConfirm = false; confirmEntryId = null; confirmOdUserId = null; confirmDisplayName = ''; }}
            style="font-size: 11px; padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">
            Cancelar
          </button>
          <button onclick={() => doTogglePaid(confirmEntryId, false, confirmOdUserId)}
            style="font-size: 11px; padding: 8px 16px; border: 1px solid var(--red); border-radius: 6px; background: rgba(255,77,106,0.15); color: var(--red); cursor: pointer; font-weight: 500;">
            Confirmar
          </button>
        </div>
      </div>
    </div>
  {/if}

</div>
