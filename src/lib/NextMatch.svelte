<script lang="ts">
  // Presentational: the upcoming fixture for the header when nothing is live.
  // Shows the kickoff TIME (not a countdown). A slow timer only exists so the
  // "hoy/mañana" day boundary rolls over correctly. In the sidebar variant the
  // team names can be wider than the 220px rail; rather than cut them off with an
  // ellipsis, we measure the overflow and gently scan side-to-side (marquee).
  import { onMount, onDestroy, tick } from 'svelte';
  import { flagEmoji, shortName } from '$lib/teams.js';

  let { match, variant = 'bar' } = $props<{ match: any; variant?: 'bar' | 'sidebar' }>();

  let nowMs = $state(Date.now());
  let iv: ReturnType<typeof setInterval> | null = null;

  // Marquee (sidebar only): measure how much the names overflow the rail.
  let wrap = $state<HTMLDivElement | undefined>(undefined);
  let pill = $state<HTMLSpanElement | undefined>(undefined);
  let shift = $state(0);
  let ro: ResizeObserver | undefined;
  function measure() {
    if (wrap && pill) shift = Math.max(0, pill.scrollWidth - wrap.clientWidth);
  }

  onMount(() => {
    iv = setInterval(() => (nowMs = Date.now()), 60_000);
    measure();
    if (typeof ResizeObserver !== 'undefined' && wrap) {
      ro = new ResizeObserver(measure);
      ro.observe(wrap);
    }
  });
  onDestroy(() => {
    if (iv) clearInterval(iv);
    if (ro) ro.disconnect();
  });

  const kickoff = $derived(match?.kickoff_time ? new Date(match.kickoff_time) : null);
  const timeLabel = $derived.by(() => {
    if (!kickoff) return '';
    const t = kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(nowMs);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(kickoff, now)) return t;
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    if (sameDay(kickoff, tomorrow)) return `mañana ${t}`;
    return `${kickoff.toLocaleDateString('es-ES', { weekday: 'short' })} ${t}`;
  });
  const hasTeams = $derived(!!(match?.home && match?.away));
  const PHASE: Record<string, string> = { r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', '3rd': '3.er puesto', final: 'Final', group: 'Grupos' };

  // Re-measure whenever the content that affects width changes (new fixture / label).
  $effect(() => {
    match; timeLabel;
    tick().then(measure);
  });
</script>

{#if match}
  {#if variant === 'sidebar'}
    <div class="nm-side">
      <span class="nm-side-label">⏭ Próximo · {timeLabel}</span>
      <div class="nm-side-teams-wrap" bind:this={wrap}>
        <span class="nm-side-teams" class:marquee={shift > 4} style="--shift: {shift}px" bind:this={pill}>
          {#if hasTeams}{@html flagEmoji(match.home_flag)} {shortName(match.home)} <span class="vs">–</span> {shortName(match.away)} {@html flagEmoji(match.away_flag)}{:else}{PHASE[match.phase] ?? 'Eliminatorias'}{/if}
        </span>
      </div>
    </div>
  {:else}
    <div class="nm-pill" role="status" aria-label="Próximo partido a las {timeLabel}">
      {#if hasTeams}
        <span class="nm-flags">{@html flagEmoji(match.home_flag)} {@html flagEmoji(match.away_flag)}</span>
      {:else}
        <span aria-hidden="true">⏭</span>
      {/if}
      <span class="nm-time">{timeLabel}</span>
    </div>
  {/if}
{/if}

<style>
  .nm-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--gold);
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 3px 9px;
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 12px;
    background: rgba(201,168,76,0.06);
    white-space: nowrap;
  }
  .nm-flags { display: inline-flex; align-items: center; gap: 2px; }
  .nm-time { color: var(--gold); }
  .nm-side { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .nm-side-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .nm-side-teams-wrap { overflow: hidden; }
  .nm-side-teams {
    font-size: 12px;
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
    display: inline-block;
    will-change: transform;
  }
  /* Scan only when the names actually overflow the rail (shift > 4px). */
  .nm-side-teams.marquee { animation: nm-marquee 7s ease-in-out infinite alternate; }
  @keyframes nm-marquee {
    from { transform: translateX(0); }
    to { transform: translateX(calc(-1 * var(--shift))); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nm-side-teams.marquee { animation: none; }
  }
  .nm-side .vs { color: var(--text-dim); }
</style>
