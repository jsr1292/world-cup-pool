<script>
  let { data } = $props();
  let tab = $state('leaderboard');

  const pool = data.pool;
  const isCreator = false; // TODO: check if current user created pool
</script>

<div>
  <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Home</a>

  <!-- Pool Header -->
  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold);">{pool.name}</h1>
    <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 10px; color: var(--text-muted);">
      <span>👥 {data.members.length} members</span>
      {#if pool.buy_in > 0}
        <span>💰 {pool.buy_in}€ buy-in</span>
      {/if}
      <span>🔗 Code: <span style="color: var(--gold); font-weight: 600;">{pool.invite_code}</span></span>
    </div>
  </div>

  <!-- Tabs -->
  <div style="display: flex; gap: 0; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
    {#each ['leaderboard', 'predictions', 'members', 'scoring'] as t}
      <button
        onclick={() => tab = t}
        style="flex: 1; padding: 8px 4px; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; border: none; background: {tab === t ? 'rgba(201,168,76,0.1)' : 'transparent'}; color: {tab === t ? 'var(--gold)' : 'var(--text-muted)'}; {t !== 'leaderboard' ? 'border-left: 1px solid var(--border);' : ''}"
      >{t}</button>
    {/each}
  </div>

  <!-- Leaderboard Tab -->
  {#if tab === 'leaderboard'}
    {#if data.leaderboard.length === 0}
      <div style="text-align: center; padding: 32px; color: var(--text-muted); font-size: 12px;">
        No predictions yet. Be the first!
      </div>
    {:else}
      <div style="display: flex; flex-direction: column; gap: 6px;">
        {#each data.leaderboard as entry, i}
          <div style="display: flex; align-items: center; gap: 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px;">
            <div style="width: 24px; text-align: center; font-weight: 700; font-size: 14px; color: {i === 0 ? 'var(--gold)' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--text-dim)'};">
              {i + 1}
            </div>
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 600;">{entry.display_name}{entry.label ? ` (${entry.label})` : ''}</div>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: var(--gold);">
              {entry.total_score} pts
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- Predictions Tab -->
  {#if tab === 'predictions'}
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;">My Predictions</h3>
      <a href="/pool/{pool.id}/predict" class="btn-primary" style="font-size: 9px; padding: 6px 14px;">+ New Bet</a>
    </div>
    {#if data.predictions.length === 0}
      <div style="text-align: center; padding: 32px; color: var(--text-muted); font-size: 12px;">
        No predictions yet. Start predicting!
      </div>
    {:else}
      {#each data.predictions as pred}
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px;">{pred.label || 'Main bet'}</span>
            <span style="font-size: 12px; color: var(--gold); font-weight: 600;">{pred.total_score} pts</span>
          </div>
        </div>
      {/each}
    {/if}
  {/if}

  <!-- Members Tab -->
  {#if tab === 'members'}
    <div style="display: flex; flex-direction: column; gap: 6px;">
      {#each data.members as member}
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
          <span style="font-size: 12px;">{member.display_name}</span>
          {#if pool.buy_in > 0}
            <span style="font-size: 9px; color: {member.has_paid ? 'var(--green)' : 'var(--red)'}; letter-spacing: 0.1em; text-transform: uppercase;">
              {member.has_paid ? '✓ Paid' : '✗ Unpaid'}
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
        <div style="display: flex; justify-content: space-between; padding: 8px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;">
          <span style="font-size: 11px; color: var(--text-muted); text-transform: capitalize;">{rule.replace(/_/g, ' ')}</span>
          <span style="font-size: 11px; font-weight: 600; color: var(--gold);">{points} pts</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
