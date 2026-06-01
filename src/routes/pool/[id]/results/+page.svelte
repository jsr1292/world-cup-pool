<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let { data } = $props();
  let selectedEntry = $state(data.selectedEntryId);

  const phaseLabels: Record<string, string> = {
    group: 'Fase de Grupos',
    r32: 'Dieciseisavos',
    r16: 'Octavos',
    qf: 'Cuartos',
    sf: 'Semifinales',
    '3rd': '3er y 4to puesto',
    final: 'Final',
  };

  const phaseOrder = ['group', 'r32', 'r16', 'qf', 'sf', '3rd', 'final'];

  import { flagEmoji as flag } from '$lib/teams.js';

  // Build user bracket lookup: phase -> match_index -> { team_id, points_earned }
  const bracketLookup: Record<string, Record<number, { team_id: number; points_earned: number }>> = {};
  for (const bp of data.userBracketPreds) {
    if (!bracketLookup[bp.phase]) bracketLookup[bp.phase] = {};
    bracketLookup[bp.phase][bp.match_index] = { team_id: bp.team_id, points_earned: bp.points_earned };
  }

  // Build user group prediction lookup: group_name -> [pos1, pos2, pos3, pos4]
  const groupPredLookup: Record<string, number[]> = {};
  for (const gp of data.userGroupPreds) {
    groupPredLookup[gp.group_name] = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
  }

  function getTeamName(id) {
    return data.teamCache[id]?.name || 'TBD';
  }

  function getTeamFlag(id) {
    return flag(data.teamCache[id]?.flag_code);
  }

  // For a finished knockout match, return the user's bracket pick (with points)
  // IF they predicted the actual winner to advance in that phase. Bracket
  // predictions are by-phase team SETS, not by-match, so we match on team_id —
  // the old lookup keyed an array index (0-15) against DB slot keys (1-32) and
  // therefore never matched correctly, and it ignored penalty winners.
  function getPredictionForWinner(phase, winnerId) {
    if (!winnerId) return null;
    return data.userBracketPreds.find(bp => bp.phase === phase && bp.team_id === winnerId) || null;
  }

  // Check if a group position prediction was correct
  function isGroupCorrect(groupName, position, actualTeamId) {
    const predicted = groupPredLookup[groupName]?.[position - 1];
    return predicted && predicted === actualTeamId;
  }

  // Group results summary for a phase
  function countFinished(phase) {
    return (data.phases[phase] || []).filter(m => m.status === 'finished').length;
  }
  function countTotal(phase) {
    return (data.phases[phase] || []).length;
  }

  let totalUserPoints = $derived(
    data.userGroupPreds.reduce((sum, g) => sum + (g.points_earned || 0), 0) +
    data.userBracketPreds.reduce((sum, b) => sum + (b.points_earned || 0), 0) +
    (data.userMatchPreds || []).reduce((sum, m) => sum + (m.points_earned || 0), 0)
  );

  // Build match predictions lookup: matchId -> { pred_home, pred_away, points_earned }
  const matchPredLookup: Record<number, { pred_home: number; pred_away: number; points_earned: number }> = {};
  for (const mp of (data.userMatchPreds || [])) {
    matchPredLookup[mp.match_id] = { pred_home: mp.pred_home, pred_away: mp.pred_away, points_earned: mp.points_earned };
  }

  // Determine color coding for match score prediction
  function getMatchResultClass(matchId) {
    const mp = matchPredLookup[matchId];
    if (!mp || mp.points_earned == null) return null;
    if (mp.points_earned >= 7) return 'exact'; // exact score (outcome + exact)
    if (mp.points_earned >= 2) return 'outcome'; // correct outcome only
    return 'wrong';
  }
</script>

<svelte:head>
  <title>Resultados · {data.pool.name}</title>
</svelte:head>

<div style="max-width: 600px; margin: 0 auto;">
  <!-- Header -->
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px; position: sticky; top: 0; background: var(--bg-base); padding: 8px 0; z-index: 5;">← {data.pool.name}</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 4px;">Resultados</h1>

  {#if data.userPredictions.length > 0}
    <div style="display: flex; gap: 12px; align-items: center; margin: 12px 0 20px;">
      <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;">Tu entrada:</span>
      <select value={selectedEntry} onchange={(e) => goto(`?entry=${(e.target as HTMLSelectElement).value}`, { invalidateAll: true })} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
        {#each data.userPredictions as pred}
          <option value={pred.id}>{pred.label || 'Entrada principal'}</option>
        {/each}
      </select>
      <span style="margin-left: auto; font-size: 14px; font-weight: 600; color: var(--gold);">{totalUserPoints} pts</span>
    </div>
  {:else}
    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 20px;">Aún no has hecho predicciones. <a href="/pool/{data.pool.id}/predict" style="color: var(--gold);">Predecir ahora</a></p>
  {/if}

  <!-- Phase sections -->
  {#each phaseOrder as phase}
    {@const matches = data.phases[phase] || []}
    {@const finished = countFinished(phase)}
    {@const total = countTotal(phase)}

    {#if matches.length > 0}
      <div style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 0;">{phaseLabels[phase] || phase}</h2>
          <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 8px; border-radius: 8px;">{finished}/{total} jugados</span>
        </div>

        {#if phase === 'group'}
          <!-- Group standings -->
          {#each Object.entries(data.groupStandings).sort(([a], [b]) => a.localeCompare(b)) as [group, teams]}
            {@const predicted = groupPredLookup[group]}
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px;">Grupo {group}</div>
              <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                <tbody>
                <tr style="color: var(--text-muted); font-size: 9px;">
                  <td style="padding: 2px 0; width: 24px;"></td>
                  <td style="padding: 2px 4px;"></td>
                  <td style="padding: 2px 4px; text-align: center;">Pts</td>
                  <td style="padding: 2px 4px; text-align: center;">GF</td>
                  <td style="padding: 2px 4px; text-align: center;">GC</td>
                  <td style="padding: 2px 4px; text-align: center;">DG</td>
                  {#if predicted}
                    <td style="padding: 2px 4px; text-align: center; font-size: 8px;">Pred.</td>
                  {/if}
                </tr>
                {#each teams as team, idx}
                  {@const correct = isGroupCorrect(group, idx + 1, team.id)}
                  <tr style="border-top: 1px solid var(--border); {idx < 2 ? 'color: var(--text);' : 'color: var(--text-muted);'}">
                    <td style="padding: 4px 0; font-size: 9px; color: var(--text-muted);">{idx + 1}</td>
                    <td style="padding: 4px;">{@html flag(team.flag_code)} {team.name}</td>
                    <td style="padding: 4px; text-align: center; font-weight: 600;">{team.pts}</td>
                    <td style="padding: 4px; text-align: center;">{team.gf}</td>
                    <td style="padding: 4px; text-align: center;">{team.ga}</td>
                    <td style="padding: 4px; text-align: center;">{team.gd > 0 ? '+' : ''}{team.gd}</td>
                    {#if predicted}
                      <td style="padding: 4px; text-align: center;">
                        {#if correct}
                          <span style="color: var(--green); font-size: 10px;">✓</span>
                        {:else if predicted[idx]}
                          <span style="color: var(--text-muted); font-size: 9px;">✗</span>
                        {:else}
                          <span style="color: var(--text-muted); font-size: 9px;">—</span>
                        {/if}
                      </td>
                    {/if}
                  </tr>
                {/each}
                </tbody>
              </table>
            </div>
          {/each}

          {#if Object.keys(data.groupStandings).length === 0}
            <p style="font-size: 11px; color: var(--text-muted); padding: 12px;">No hay resultados de fase de grupos todavía.</p>
          {/if}
        {:else}
          <!-- Knockout matches -->
          {#each matches as match, mi}
            {@const isFinished = match.status === 'finished'}
            {@const homeWin = isFinished && match.home_score > match.away_score}
            {@const awayWin = isFinished && match.away_score > match.home_score}
            {@const mp = matchPredLookup[match.id]}
            {@const resultClass = isFinished ? getMatchResultClass(match.id) : null}

            <div style="background: var(--bg-surface); border: 1px solid {resultClass === 'exact' ? 'rgba(0,229,160,0.5)' : resultClass === 'outcome' ? 'rgba(255,200,0,0.4)' : resultClass === 'wrong' ? 'rgba(255,77,106,0.3)' : 'var(--border)'}; border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
              <!-- Home -->
              <span style="flex: 1; text-align: right; font-size: 12px; {homeWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">
                {@html flag(match.home_flag)} {match.home_name ?? 'TBD'}
              </span>

              <!-- Score -->
              <div style="min-width: 56px; text-align: center;">
                {#if isFinished}
                  <span style="font-size: 14px; font-weight: 700; color: var(--gold);">{match.home_score} - {match.away_score}</span>
                  {#if match.penalty_winner_id}
                    <div style="font-size: 8px; color: var(--text-muted); white-space: nowrap;">pen. {getTeamName(match.penalty_winner_id)}</div>
                  {/if}
                {:else if match.status === 'live'}
                  <span style="font-size: 11px; color: var(--red); font-weight: 600;">EN JUEGO</span>
                {:else}
                  <span style="font-size: 9px; color: var(--text-muted);">{match.kickoff_time ? new Date(match.kickoff_time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'Pend.'}</span>
                {/if}
              </div>

              <!-- Away -->
              <span style="flex: 1; text-align: left; font-size: 12px; {awayWin ? 'font-weight: 600; color: var(--text);' : isFinished ? 'color: var(--text-muted);' : 'color: var(--text);'}">
                {match.away_name ?? 'TBD'} {@html flag(match.away_flag)}
              </span>
            </div>

            <!-- Prediction comparison + Match score prediction -->
            {#if isFinished && mp}
              {@const ptsLabel = mp.points_earned > 0 ? `+${mp.points_earned}pts` : '0pts'}
              {@const resultColor = mp.points_earned >= 7 ? 'var(--green)' : mp.points_earned >= 2 ? '#ffc800' : 'var(--red)'}
              <div style="font-size: 10px; padding: 0 0 8px 0; text-align: center; color: var(--text-muted);">
                Tu marcador: <strong style="color: var(--text);">{mp.pred_home} - {mp.pred_away}</strong>
                · <span style="color: {resultColor}; font-weight: 600;">{ptsLabel}</span>
                · {#if mp.points_earned >= 7}<span style="color: var(--green);">✓ Exact</span>{:else if mp.points_earned >= 2}<span style="color: #ffc800;">✓ Resultado</span>{:else}<span style="color: var(--red);">✗</span>{/if}
              </div>
            {:else if isFinished}
              {@const actualWinner = homeWin ? match.home_team_id : awayWin ? match.away_team_id : (match.penalty_winner_id || null)}
              {@const myHit = getPredictionForWinner(phase, actualWinner)}
              {#if myHit}
                <div style="font-size: 9px; padding: 0 0 6px 0; text-align: center; color: var(--green);">
                  ✓ Acertaste el ganador: {getTeamFlag(actualWinner)} {getTeamName(actualWinner)} +{myHit.points_earned}pts
                </div>
              {/if}
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  {/each}

  {#if Object.keys(data.phases).length === 0}
    <div style="text-align: center; padding: 40px 20px;">
      <p style="font-size: 16px; margin-bottom: 8px;">⚽</p>
      <p style="font-size: 12px; color: var(--text-muted);">Los resultados aparecerán aquí cuando comience el torneo.</p>
      <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Mundial 2026 · 11 de junio</p>
    </div>
  {/if}
</div>
