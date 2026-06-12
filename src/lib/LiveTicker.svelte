<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { flagEmoji, shortName } from '$lib/teams.js';
  import { WORLD_CUP_KICKOFF_MS, WORLD_CUP_DURATION_MS } from '$lib/constants.js';

  type M = { home: string; home_flag: string; home_score: number; away: string; away_flag: string; away_score: number; minute: string };
  let matches = $state<M[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  // Only poll during the tournament window — never before kickoff or after it ends.
  const inWindow = () => {
    const now = Date.now();
    return now >= WORLD_CUP_KICKOFF_MS && now <= WORLD_CUP_KICKOFF_MS + WORLD_CUP_DURATION_MS;
  };

  async function poll() {
    if (!inWindow()) { matches = []; return; }
    try {
      const r = await fetch('/api/live');
      if (r.ok) { const d = await r.json(); matches = Array.isArray(d.matches) ? d.matches : []; }
    } catch { /* keep last */ }
  }

  onMount(() => {
    if (!browser || !inWindow()) return;
    poll();
    timer = setInterval(poll, 30_000);
    // refresh promptly when the tab regains focus
    const onVis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVis);
    onDestroy(() => document.removeEventListener('visibilitychange', onVis));
  });
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

{#if matches.length > 0}
  <div class="live-ticker" role="status" aria-label="Marcadores en directo">
    <span class="live-dot" aria-hidden="true"></span>
    <span class="live-label">EN VIVO</span>
    <div class="live-track-wrap">
      <div class="live-track" class:scroll={matches.length > 1}>
        {#each matches as m}
          <span class="live-item">
            {@html flagEmoji(m.home_flag)} {shortName(m.home)} <b>{m.home_score}–{m.away_score}</b> {shortName(m.away)} {@html flagEmoji(m.away_flag)}{#if m.minute}<span class="live-min"> {m.minute}</span>{/if}
          </span>
        {/each}
        {#if matches.length > 1}
          <!-- duplicate for a seamless loop -->
          {#each matches as m}
            <span class="live-item" aria-hidden="true">
              {@html flagEmoji(m.home_flag)} {shortName(m.home)} <b>{m.home_score}–{m.away_score}</b> {shortName(m.away)} {@html flagEmoji(m.away_flag)}{#if m.minute}<span class="live-min"> {m.minute}</span>{/if}
            </span>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .live-ticker {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(90deg, rgba(255,77,106,0.12), rgba(255,77,106,0.04));
    border-bottom: 1px solid rgba(255,77,106,0.25);
    padding: 6px 12px; font-size: 12px; color: var(--text);
    overflow: hidden; white-space: nowrap;
  }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #ff4d6a; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
  .live-label { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; color: #ff4d6a; flex-shrink: 0; }
  .live-track-wrap { flex: 1; min-width: 0; overflow: hidden; }
  .live-track { display: inline-flex; gap: 28px; will-change: transform; }
  .live-track.scroll { animation: ticker 24s linear infinite; }
  .live-track:not(.scroll) { padding-left: 4px; }
  .live-item { flex-shrink: 0; }
  .live-item b { color: var(--gold); font-weight: 700; }
  .live-min { color: #ff4d6a; font-weight: 700; font-size: 10px; }
  @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .live-track.scroll { animation: none; } }
</style>
