<script lang="ts">
  let { data } = $props();
  let selectedEntry = $state(data.entries.length > 0 ? data.entries[0].id : null);

  const phaseLabels: Record<string, string> = {
    r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', '3rd': '3er puesto', final: 'Final',
  };
  const phaseOrder = ['r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  import { flagEmoji as flag, shortName } from '$lib/teams.js';

  function teamName(id: number) { const n = data.teams[id]?.name; return n ? shortName(n) : 'TBD'; }
  function teamFlag(id: number) { return flag(data.teams[id]?.flag_code || ''); }

  function getEntry() { return data.entries.find((e: any) => e.id === selectedEntry); }

  // Friendly entry name — mirror the predict page: an empty label is the
  // primary entry ("Entrada principal"), not "Entrada <db-id>".
  function entryLabel(e: any) { return e?.label || 'Entrada principal'; }

  let emailing = $state(false);
  let emailMsg = $state('');
  async function emailMyPicks() {
    if (!selectedEntry || emailing) return;
    emailing = true; emailMsg = '';
    try {
      const res = await fetch('/api/predictions/email-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: selectedEntry }),
      });
      const d = await res.json().catch(() => ({}));
      emailMsg = res.ok ? `✓ Enviado a ${d.sent_to}` : `✗ ${d.error || 'Error'}`;
    } catch {
      emailMsg = '✗ Error de conexión';
    }
    emailing = false;
    setTimeout(() => { emailMsg = ''; }, 4000);
  }

  function getGroupPreds() {
    if (!selectedEntry) return [];
    return data.groupPreds[selectedEntry] || [];
  }

  function fmtMatchDate(ts: string | null): string {
    if (!ts) return 'Fecha por confirmar';
    return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Per-match 1/X/2 picks for the selected entry, chronological (server orders
  // them by kickoff), bucketed into consecutive date groups for date headers.
  function getMatchPredsByDate(): [string, any[]][] {
    if (!selectedEntry) return [];
    const out: [string, any[]][] = [];
    let cur: [string, any[]] | null = null;
    for (const mp of (data.matchPreds?.[selectedEntry] || [])) {
      const label = fmtMatchDate(mp.kickoff_time);
      if (!cur || cur[0] !== label) { cur = [label, []]; out.push(cur); }
      cur[1].push(mp);
    }
    return out;
  }

  // Derive the 1/X/2 code from the stored canonical scoreline (1-0 / 0-0 / 0-1).
  function pickCode(mp: any): '1' | 'X' | '2' {
    if (mp.pred_home > mp.pred_away) return '1';
    if (mp.pred_home < mp.pred_away) return '2';
    return 'X';
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

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">📋 {data.viewing ? 'Predicciones' : 'Resumen de Predicciones'}</h1>

  {#if data.viewing}
    <div style="display: flex; gap: 10px; align-items: center; margin: 12px 0 16px; padding: 10px 12px; background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.3); border-radius: 8px;">
      <span style="font-size: 16px;">👁️</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; font-weight: 600; color: var(--gold);">Apuestas de {data.viewing.owner}{#if data.viewing.label} · {data.viewing.label}{/if}</div>
        <a href="/pool/{data.pool.id}" style="font-size: 9px; color: var(--text-muted);">← Volver a la clasificación</a>
        · <a href="/pool/{data.pool.id}/h2h?b={selectedEntry}" style="font-size: 9px; color: var(--gold);">⚔️ Comparar con las mías</a>
      </div>
      {#if data.entries[0]}<span style="font-size: 14px; font-weight: 600; color: var(--gold);">{data.entries[0].total_score} pts</span>{/if}
    </div>
  {/if}

  {#if data.entries.length === 0}
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 16px;">No tienes predicciones aún. <a href="/pool/{data.pool.id}/predict" style="color: var(--gold);">Predecir ahora</a></p>
  {:else}
    <!-- Entry selector (own entries only) -->
    {#if !data.viewing && data.entries.length > 1}
      <div style="margin: 12px 0 20px;">
        <select bind:value={selectedEntry} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
          {#each data.entries as pred}
            <option value={pred.id}>{entryLabel(pred)}</option>
          {/each}
        </select>
      </div>
    {/if}

    {@const entry = getEntry()}
    {#if entry && !data.viewing}
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">
        {entryLabel(entry)} · {data.pool.name}
      </div>
    {/if}

    {#if data.emailEnabled && !data.viewing}
      <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <button onclick={emailMyPicks} disabled={emailing} class="btn-ghost" style="font-size: 10px; padding: 6px 12px;">
          {emailing ? 'Enviando…' : '📧 Recibir por email'}
        </button>
        {#if emailMsg}
          <span style="font-size: 10px; color: {emailMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)'};">{emailMsg}</span>
        {/if}
      </div>
    {/if}

    <!-- Group match picks (1/X/2 per game) — chronological, surfaced first -->
    <div style="margin-bottom: 24px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">⚽ Partidos de grupos · 1 / X / 2</h2>
      <p style="font-size: 9px; color: var(--text-dim); margin-bottom: 6px;">1 = gana el local · X = empate · 2 = gana el visitante</p>
      {#each getMatchPredsByDate() as [dateLabel, mps]}
        <div style="font-size: 9px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 4px;">{dateLabel}</div>
        <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 2px 12px;">
          {#each mps as mp, mi}
            {@const code = pickCode(mp)}
            {@const played = mp.status === 'finished' && mp.actual_home != null}
            {@const correct = played && mp.points_earned > 0}
            <div style="display: flex; align-items: center; gap: 7px; padding: 7px 0; {mi > 0 ? 'border-top: 1px solid var(--border);' : ''}">
              <span style="flex-shrink: 0; width: 14px; font-size: 8px; color: var(--text-dim);">{mp.group_name}</span>
              <span style="flex: 1; min-width: 0; text-align: right; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {code === '1' ? 'font-weight: 700; color: var(--text);' : 'color: var(--text-muted);'}">{teamName(mp.home_team_id)} {@html teamFlag(mp.home_team_id)}</span>
              <span style="flex-shrink: 0; min-width: 22px; text-align: center;">
                <span style="display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 5px; background: {code === 'X' ? 'rgba(255,255,255,0.08)' : 'rgba(201,168,76,0.16)'}; color: {code === 'X' ? 'var(--text-muted)' : 'var(--gold)'};">{code}</span>
              </span>
              <span style="flex: 1; min-width: 0; text-align: left; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {code === '2' ? 'font-weight: 700; color: var(--text);' : 'color: var(--text-muted);'}">{@html teamFlag(mp.away_team_id)} {teamName(mp.away_team_id)}</span>
              <span style="flex-shrink: 0; width: 46px; text-align: right; font-size: 9px; color: {played ? (correct ? 'var(--green)' : 'var(--red)') : 'var(--text-dim)'};">
                {#if played}{mp.actual_home}-{mp.actual_away} {correct ? '✓' : '✗'}{/if}
              </span>
            </div>
          {/each}
        </div>
      {/each}

      {#if getMatchPredsByDate().length === 0}
        <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No hay pronósticos de partidos.</p>
      {/if}
    </div>

    <!-- Group predictions (final-table order) — secondary, below the games -->
    <div style="margin-bottom: 24px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">🏆 Clasificación de grupos (orden final)</h2>
      <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 10px;">Verde = posición acertada. El ✗ muestra qué equipo quedó realmente en ese puesto.</p>
      {#each getGroupPreds() as gp}
        {@const actual = data.actualGroups?.[gp.group_name]}
        {@const fin = data.groupFinished?.[gp.group_name] ?? 0}
        {@const complete = fin === 6 && !!actual}
        {@const nCorrect = complete ? [gp.position_1, gp.position_2, gp.position_3, gp.position_4].filter((tid, i) => tid && actual[i] === tid).length : 0}
        <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 6px;">
          <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Grupo {gp.group_name}</div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            {#each [gp.position_1, gp.position_2, gp.position_3, gp.position_4] as tid, idx}
              {@const correct = complete && !!tid && actual[idx] === tid}
              {@const wrong = complete && !!tid && !!actual[idx] && actual[idx] !== tid}
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; {idx < 2 ? 'color: var(--text); font-weight: 500;' : 'color: var(--text-muted);'}">
                <span style="width: 14px; font-size: 9px; color: var(--text-muted);">{idx + 1}.</span>
                {#if tid}
                  <span>{@html teamFlag(tid)}</span>
                  <span>{teamName(tid)}</span>
                {:else}
                  <span style="opacity: 0.5;">—</span>
                {/if}
                {#if correct}
                  <span style="color: var(--green); font-size: 10px; font-weight: 700;">✓</span>
                {:else if wrong}
                  <span style="color: var(--red); font-size: 10px;">✗</span>
                  <span style="color: var(--text-dim); font-size: 10px;">→ {@html teamFlag(actual[idx])} {teamName(actual[idx])}</span>
                {/if}
              </div>
            {/each}
          </div>
          {#if fin < 6}
            <div style="margin-top: 8px; font-size: 9px; color: var(--text-muted); background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.2); border-radius: 5px; padding: 5px 7px;">⏳ Pendiente — se puntúa al completarse el grupo ({fin}/6)</div>
          {:else}
            <div style="margin-top: 8px; font-size: 9px; color: var(--green); background: rgba(0,229,160,0.07); border: 1px solid rgba(0,229,160,0.2); border-radius: 5px; padding: 5px 7px;">✓ Acertaste {nCorrect}/4{#if gp.points_earned > 0} · +{gp.points_earned} pts{/if}</div>
          {/if}
        </div>
      {/each}

      {#if getGroupPreds().length === 0}
        <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No has predicho grupos aún.</p>
      {/if}
    </div>

    <!-- Bracket predictions -->
    <div style="margin-bottom: 24px;">
      <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">⚔️ Eliminatorias</h2>
      <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 10px;">Verde = avanzó (puntos sumados) · Rojo = eliminado.</p>
      {#each phaseOrder as phase}
        {@const bracketPreds = getBracketPreds()}
        {@const picks = bracketPreds[phase]}
        {#if picks && picks.length > 0}
          {@const phasePts = picks.reduce((sum: number, p: any) => sum + (p.points_earned || 0), 0)}
          <div style="margin-bottom: 12px;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">{phaseLabels[phase] || phase}{#if phasePts > 0}<span style="color: var(--green); font-weight: 700; text-transform: none; letter-spacing: 0;"> · +{phasePts} pts</span>{/if}</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              {#each picks as pick}
                {@const st = pick.state}
                <span style="border-radius: 4px; padding: 4px 8px; font-size: 11px; background: {st === 'correct' ? 'rgba(0,229,160,0.12)' : st === 'wrong' ? 'rgba(255,77,106,0.10)' : 'var(--bg-surface)'}; border: 1px solid {st === 'correct' ? 'rgba(0,229,160,0.4)' : st === 'wrong' ? 'rgba(255,77,106,0.3)' : 'var(--border)'}; {st === 'wrong' ? 'opacity: 0.65;' : ''}">
                  {@html teamFlag(pick.team_id)} {teamName(pick.team_id)}{#if st === 'correct'} <span style="color: var(--green); font-weight: 700;">✓+{pick.points_earned}</span>{:else if st === 'wrong'} <span style="color: var(--red);">✗</span>{/if}
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
