<script lang="ts">
  // Presentational: the upcoming fixture for the header when nothing is live.
  // Shows the kickoff TIME (not a countdown). A slow timer only exists so the
  // "hoy/mañana" day boundary rolls over correctly.
  import { onMount, onDestroy } from 'svelte';
  import { flagEmoji, shortName } from '$lib/teams.js';

  let { match, variant = 'bar' } = $props<{ match: any; variant?: 'bar' | 'sidebar' }>();

  let nowMs = $state(Date.now());
  let iv: ReturnType<typeof setInterval> | null = null;
  onMount(() => { iv = setInterval(() => (nowMs = Date.now()), 60_000); });
  onDestroy(() => { if (iv) clearInterval(iv); });

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
</script>

{#if match}
  {#if variant === 'sidebar'}
    <div class="nm-side">
      <span class="nm-side-label">⏭ Próximo · {timeLabel}</span>
      <span class="nm-side-teams">
        {#if hasTeams}{@html flagEmoji(match.home_flag)} {shortName(match.home)} <span class="vs">–</span> {shortName(match.away)} {@html flagEmoji(match.away_flag)}{:else}{PHASE[match.phase] ?? 'Eliminatorias'}{/if}
      </span>
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
  .nm-side-teams { font-size: 12px; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-side .vs { color: var(--text-dim); }
</style>
