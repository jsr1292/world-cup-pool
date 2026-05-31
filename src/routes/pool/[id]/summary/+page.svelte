<script lang="ts">
  let { data } = $props();
  let selectedEntry = $state(data.entries.length > 0 ? data.entries[0].id : null);

  const phaseLabels: Record<string, string> = {
    r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', '3rd': '3er puesto', final: 'Final',
  };
  const phaseOrder = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  function flag(code: string) {
    if (!code) return '';
    return code.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
  }

  function teamName(id: number) { return data.teams[id]?.name || 'TBD'; }
  function teamFlag(id: number) { return flag(data.teams[id]?.flag_code || ''); }

  function getEntry() { return data.entries.find((e: any) => e.id === selectedEntry); }

  // Friendly entry name — mirror the predict page: an empty label is the
  // primary entry ("Entrada principal"), not "Entrada <db-id>".
  function entryLabel(e: any) { return e?.label || 'Entrada principal'; }

  function getGroupPreds() {
    if (!selectedEntry) return [];
    return data.groupPreds[selectedEntry] || [];
  }

  function getBracketPreds() {
    if (!selectedEntry) return [];
    const raw = data.bracketPreds[selectedEntry] || [];
    // Group by phase
    const grouped: Record<string, any[]> = {};
    for (const b of raw) {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    }
    return grouped;
  }
</script>

<svelte:head>
  <title>Resumen · {data.pool.name}</title>
</svelte:head>

<div style="max-width: 500px; margin: 0 auto;">
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px; position: sticky; top: 0; background: var(--bg-base); padding: 8px 0; z-index: 5;">← {data.pool.name}</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">📋 Resumen de Predicciones</h1>

  {#if data.entries.length === 0}
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 16px;">No tienes predicciones aún. <a href="/pool/{data.pool.id}/predict" style="color: var(--gold);">Predecir ahora</a></p>
  {:else}
    <!-- Entry selector -->
    {#if data.entries.length > 1}
      <div style="margin: 12px 0 20px;">
        <select bind:value={selectedEntry} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
          {#each data.entries as pred}
            <option value={pred.id}>{entryLabel(pred)}</option>
          {/each}
        </select>
      </div>
    {/if}

    {@const entry = getEntry()}
    {#if entry}
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">
        {entryLabel(entry)} · {data.pool.name}
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

    <!-- Share hint -->
    <div style="text-align: center; padding: 16px; border-top: 1px solid var(--border);">
      <p style="font-size: 9px; color: var(--text-muted);">📸 Haz captura para compartir</p>
    </div>
  {/if}
</div>
