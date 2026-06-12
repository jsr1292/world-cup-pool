<script lang="ts">
  let { data } = $props();

  const phaseLabels: Record<string, string> = {
    group: 'Grupos', r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos',
    sf: 'Semifinales', final: 'Final', '3rd': '3er puesto',
  };

  // Dense ranking ("1-2-2-3"): everyone level on points shares a position, so
  // tied players all get the same medal/number (a tie shares the prize). The
  // leaderboard arrives sorted by total_score DESC.
  const ranks = $derived.by(() => {
    const lb = (data.leaderboard ?? []) as any[];
    const r: number[] = [];
    let rank = 0;
    let prev: number | null = null;
    for (let i = 0; i < lb.length; i++) {
      if (lb[i].total_score !== prev) { rank += 1; prev = lb[i].total_score; }
      r[i] = rank;
    }
    return r;
  });
</script>

<svelte:head>
  <title>{data.pool.name} · Clasificación</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div style="max-width: 540px; margin: 0 auto; padding: 20px 16px;">
  <!-- Header -->
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="font-size: 32px; margin-bottom: 8px;">🏆</div>
    <h1 style="font-size: 22px; font-weight: 700; color: var(--gold); margin-bottom: 4px;">{data.pool.name}</h1>
    <div style="font-size: 11px; color: var(--text-muted);">
      {data.memberCount} miembro{data.memberCount !== 1 ? 's' : ''}
      {data.pool.buy_in > 0 ? ` · ${data.pool.buy_in}€ entrada` : ''}
    </div>
  </div>

  <!-- Leaderboard -->
  {#if data.leaderboard.length === 0}
    <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
      <div style="font-size: 40px; margin-bottom: 12px;">📊</div>
      <p style="font-size: 13px;">Sin pronósticos aún</p>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 8px;">
      {#each data.leaderboard as entry, i}
        {@const rank = ranks[i]}
        <div style="display: flex; align-items: center; gap: 12px; background: {rank === 1 ? 'rgba(201,168,76,0.06)' : 'var(--bg-card)'}; border: 1px solid {rank === 1 ? 'rgba(201,168,76,0.2)' : 'var(--border)'}; border-radius: 8px; padding: 12px 16px; {rank === 1 ? 'box-shadow: 0 0 16px rgba(201,168,76,0.1);' : ''}">
          <!-- Position -->
          <div style="width: 28px; text-align: center; font-weight: 700; font-size: 14px; {rank === 1 ? 'color: var(--gold);' : rank === 2 ? 'color: #a0a0a0;' : rank === 3 ? 'color: #b87333;' : 'color: var(--text-dim);'}">
            {rank <= 3 ? ['🥇','🥈','🥉'][rank - 1] : `${rank}`}
          </div>
          <!-- Avatar -->
          <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; {rank === 1 ? 'background: linear-gradient(135deg, #c9a84c, #e8c96a); color: #1a1a2e;' : rank === 2 ? 'background: linear-gradient(135deg, #a0a0a0, #c0c0c0); color: #1a1a2e;' : rank === 3 ? 'background: linear-gradient(135deg, #b87333, #cd7f32); color: #1a1a2e;' : 'background: rgba(255,255,255,0.06); color: var(--text-dim);'} flex-shrink: 0;">
            {entry.display_name?.[0]?.toUpperCase() || '?'}
          </div>
          <!-- Name + details -->
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; font-weight: 600; {rank === 1 ? 'color: var(--gold);' : ''}">{entry.display_name}{entry.label ? ` (${entry.label})` : ''}</div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
              {#if entry.group_correct > 0}
                <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 3px;">Grupos: {entry.group_correct}</span>
              {/if}
              {#each Object.entries(entry.bracket_correct || {}) as [phase, count]}
                <span style="font-size: 9px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 3px;">{phaseLabels[phase] || phase}: {count}</span>
              {/each}
            </div>
          </div>
          <!-- Score -->
          <div style="text-align: right;">
            <div style="font-size: 18px; font-weight: 700; color: var(--gold);">{entry.total_score}</div>
            <div style="font-size: 9px; color: var(--text-muted);">pts</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Footer -->
  <div style="text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);">
    <div style="font-size: 10px; color: var(--text-dim);">Mundial 2026 · Quiniela</div>
  </div>
</div>
