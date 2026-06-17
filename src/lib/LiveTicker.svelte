<script lang="ts">
  // Presentational only — the layout owns the single poller and passes matches.
  type M = { home_code: string; home_score: number; away_code: string; away_score: number; minute: string; my_pick?: '1' | 'X' | '2' | null };
  let { matches = [] as M[] } = $props();
</script>

{#if matches.length > 0}
  <div class="live-ticker" role="status" aria-label="Marcadores en directo">
    <span class="live-dot" aria-hidden="true"></span>
    <div class="live-track-wrap">
      <div class="live-track" class:scroll={matches.length > 1}>
        {#each matches as m}
          <span class="live-item"><b>{m.home_code}</b> <span class="sc">{m.home_score}–{m.away_score}</span> <b>{m.away_code}</b>{#if m.minute}<span class="min"> {m.minute}</span>{/if}{#if m.my_pick}{@const hit = (m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X') === m.my_pick}<span class="mine" class:hit> · tú {m.my_pick}</span>{/if}</span>
        {/each}
        {#if matches.length > 1}
          {#each matches as m}
            <span class="live-item" aria-hidden="true"><b>{m.home_code}</b> <span class="sc">{m.home_score}–{m.away_score}</span> <b>{m.away_code}</b>{#if m.minute}<span class="min"> {m.minute}</span>{/if}{#if m.my_pick}{@const hit = (m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X') === m.my_pick}<span class="mine" class:hit> · tú {m.my_pick}</span>{/if}</span>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .live-ticker { display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; min-width: 0; }
  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #ff4d6a; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
  .live-track-wrap { flex: 1; min-width: 0; overflow: hidden; }
  .live-track { display: inline-flex; gap: 22px; will-change: transform; }
  .live-track.scroll { animation: ticker 18s linear infinite; }
  .live-item { flex-shrink: 0; font-size: 11px; color: var(--text); }
  .live-item b { color: var(--text); font-weight: 700; letter-spacing: 0.02em; }
  .live-item .sc { color: var(--gold); font-weight: 800; margin: 0 1px; }
  .live-item .min { color: #ff4d6a; font-weight: 700; font-size: 9px; margin-left: 4px; }
  .live-item .mine { color: var(--text-dim); font-size: 9px; font-weight: 700; }
  .live-item .mine.hit { color: var(--green); }
  @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .live-track.scroll { animation: none; } }
</style>
