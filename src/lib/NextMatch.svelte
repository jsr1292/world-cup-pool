<script lang="ts">
  // Presentational: the upcoming fixture for the header when nothing is live.
  // Owns a small timer so the "en Xh Ym" countdown stays current between polls.
  import { onMount, onDestroy } from 'svelte';
  import { flagEmoji, shortName } from '$lib/teams.js';

  let { match, variant = 'bar' } = $props<{ match: any; variant?: 'bar' | 'sidebar' }>();

  let nowMs = $state(Date.now());
  let iv: ReturnType<typeof setInterval> | null = null;
  onMount(() => { iv = setInterval(() => (nowMs = Date.now()), 30_000); });
  onDestroy(() => { if (iv) clearInterval(iv); });

  const kickoffMs = $derived(match?.kickoff_time ? new Date(match.kickoff_time).getTime() : null);
  const rel = $derived.by(() => {
    if (kickoffMs == null) return '';
    const diff = kickoffMs - nowMs;
    if (diff <= 0) return 'pronto';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d >= 1) return `${d}d ${h}h`;
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}m`;
  });
  const hasTeams = $derived(!!(match?.home && match?.away));
  const PHASE: Record<string, string> = { r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', '3rd': '3.er puesto', final: 'Final', group: 'Grupos' };
</script>

{#if match}
  {#if variant === 'sidebar'}
    <div class="nm-side">
      <span class="nm-side-label">⏭ Próximo · en {rel}</span>
      <span class="nm-side-teams">
        {#if hasTeams}{@html flagEmoji(match.home_flag)} {shortName(match.home)} <span class="vs">–</span> {shortName(match.away)} {@html flagEmoji(match.away_flag)}{:else}{PHASE[match.phase] ?? 'Eliminatorias'}{/if}
      </span>
    </div>
  {:else}
    <div class="nm-bar" role="status" aria-label="Próximo partido">
      <span class="nm-tag" aria-hidden="true">⏭</span>
      <span class="nm-text">{#if hasTeams}{@html flagEmoji(match.home_flag)} <b>{shortName(match.home)}</b> – <b>{shortName(match.away)}</b> {@html flagEmoji(match.away_flag)}{:else}<b>{PHASE[match.phase] ?? 'Próximo'}</b>{/if} <span class="nm-when">· en {rel}</span></span>
    </div>
  {/if}
{/if}

<style>
  .nm-bar { display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; min-width: 0; }
  .nm-tag { flex-shrink: 0; font-size: 11px; }
  .nm-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--text-muted); }
  .nm-text b { color: var(--text); font-weight: 600; }
  .nm-when { color: var(--gold); font-weight: 700; }
  .nm-side { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .nm-side-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .nm-side-teams { font-size: 12px; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-side .vs { color: var(--text-dim); }
</style>
