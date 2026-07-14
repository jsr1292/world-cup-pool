<script lang="ts">
  import { flagEmoji, shortName } from '$lib/teams.js';
  import Icon from '$lib/Icon.svelte';

  // "Qué se juega" — the final-days banner. Renders only CERTAINTIES from the
  // exact enumeration: either the pool is already decided, or a coming game
  // decides it ("si gana Francia, la gana Juan"). Silent otherwise.
  interface StakesTeam { name: string; flag: string }
  interface StakesMatch {
    id: number; phase: string; kickoff: string | null;
    home: StakesTeam; away: StakesTeam;
    winnersIfHome: string[] | null; winnersIfAway: string[] | null;
  }
  interface StakesResponse { champions: string[] | null; matches: StakesMatch[] }

  let { stakes }: { stakes: StakesResponse | null } = $props();

  const PHASE_LABEL: Record<string, string> = {
    r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', '3rd': '3.er puesto', final: 'LA FINAL',
  };
  // First names read better in a banner.
  const who = (ws: string[]) => {
    const firsts = ws.map((n) => n.split(/\s+/).slice(0, 2).join(' '));
    return firsts.length === 1 ? firsts[0] : `${firsts.join(' y ')} (empate)`;
  };
  const decisive = $derived((stakes?.matches ?? []).filter((m) => m.winnersIfHome || m.winnersIfAway));
</script>

{#if stakes?.champions}
  <section class="stakes decided">
    <div class="stakes-head"><Icon name="trophy" size={14} stroke={1.8} /> LA QUINIELA YA TIENE GANADOR</div>
    <div class="stakes-line"><strong>{who(stakes.champions)}</strong> gana la quiniela pase lo que pase — es matemático.</div>
  </section>
{:else if decisive.length > 0}
  <section class="stakes">
    <div class="stakes-head"><Icon name="trophy" size={14} stroke={1.8} /> QUÉ SE JUEGA LA QUINIELA</div>
    {#each decisive as m (m.id)}
      <div class="stakes-match">
        <span class="stakes-phase">{PHASE_LABEL[m.phase] ?? m.phase}</span>
        <div class="stakes-sides">
          <span class="stakes-side">
            Si gana {@html m.home.flag ? flagEmoji(m.home.flag) : ''} <b>{shortName(m.home.name)}</b>
            → {#if m.winnersIfHome}<Icon name="trophy" size={13} stroke={1.8} /> <strong>{who(m.winnersIfHome)}</strong>{:else}aún abierto{/if}
          </span>
          <span class="stakes-side">
            Si gana {@html m.away.flag ? flagEmoji(m.away.flag) : ''} <b>{shortName(m.away.name)}</b>
            → {#if m.winnersIfAway}<Icon name="trophy" size={13} stroke={1.8} /> <strong>{who(m.winnersIfAway)}</strong>{:else}aún abierto{/if}
          </span>
        </div>
      </div>
    {/each}
  </section>
{/if}

<style>
  .stakes {
    margin: 0 0 16px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid rgba(201, 168, 76, 0.45);
    background: linear-gradient(135deg, rgba(201, 168, 76, 0.14), rgba(201, 168, 76, 0.05));
  }
  .stakes-head {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
    color: var(--gold); margin-bottom: 8px;
  }
  .stakes-line { font-size: 14px; color: var(--text); }
  .decided .stakes-line strong { color: var(--gold); }

  .stakes-match { display: flex; flex-direction: column; gap: 4px; }
  .stakes-match + .stakes-match { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(201, 168, 76, 0.2); }
  .stakes-phase { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
  .stakes-sides { display: flex; flex-direction: column; gap: 3px; }
  .stakes-side { font-size: 13px; color: var(--text); line-height: 1.45; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .stakes-side strong { color: var(--gold); }
  .stakes-side :global(img) { width: 16px; height: auto; border-radius: 2px; vertical-align: middle; }
</style>
