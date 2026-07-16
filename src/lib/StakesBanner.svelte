<script lang="ts">
  import { flagEmoji, shortName } from '$lib/teams.js';
  import Icon from '$lib/Icon.svelte';
  import { fmtMoney } from '$lib/prizes.js';

  // "Qué se juega" — the final-days banner. Renders only CERTAINTIES from the
  // exact enumeration: either the pool is already decided, or a coming game
  // decides it ("si gana Francia, la gana Juan"). Silent otherwise.
  interface StakesTeam { name: string; flag: string }
  interface StakesMatch {
    id: number; phase: string; kickoff: string | null;
    home: StakesTeam; away: StakesTeam;
    winnersIfHome: string[] | null; winnersIfAway: string[] | null;
  }
  interface StakesPodiumRow { position: number; names: string[]; prize: number | null }
  interface StakesResponse {
    champions: string[] | null;
    podium: StakesPodiumRow[];
    matches: StakesMatch[];
  }

  let { stakes, currency = 'EUR' }:
    { stakes: StakesResponse | null; currency?: string } = $props();

  const PHASE_LABEL: Record<string, string> = {
    r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', '3rd': '3.er puesto', final: 'LA FINAL',
  };
  // First names read better in a banner.
  const who = (ws: string[]) => {
    const firsts = ws.map((n) => n.split(/\s+/).slice(0, 2).join(' '));
    return firsts.length === 1 ? firsts[0] : `${firsts.join(' y ')} (empate)`;
  };
  const decisive = $derived((stakes?.matches ?? []).filter((m) => m.winnersIfHome || m.winnersIfAway));
  const POS_LABEL: Record<number, string> = { 1: '1.º', 2: '2.º', 3: '3.º' };
  const podium = $derived(stakes?.podium ?? []);
  const headline = $derived(
    stakes?.champions && podium.length === 3 ? 'PODIO YA DECIDIDO'
    : stakes?.champions ? 'LA QUINIELA YA TIENE GANADOR'
    : 'PODIO — EN PARTE DECIDIDO'
  );
  // A position with no settled row gets a placeholder ("— aún en juego") when a
  // settled position exists BELOW it. Dense ranks are contiguous, so any settled
  // rank q > p proves rank p exists even though the engine can't yet say who's
  // there — this covers both a bracketed gap and a leading gap (settled 2nd, open
  // 1st). A trailing gap (e.g. missing 3rd with nothing settled below) stays
  // absent, because the pool may not even have a 3rd place.
  const displayRows = $derived.by((): { position: number; row: StakesPodiumRow | null }[] => {
    const positions = podium.map((r) => r.position);
    const rows: { position: number; row: StakesPodiumRow | null }[] = [];
    for (let p = 1; p <= 3; p++) {
      const row = podium.find((r) => r.position === p);
      if (row) { rows.push({ position: p, row }); continue; }
      if (positions.some((q) => q > p)) rows.push({ position: p, row: null });
    }
    return rows;
  });
</script>

{#if podium.length > 0}
  <section class="stakes decided">
    <div class="stakes-head"><Icon name="trophy" size={14} stroke={1.8} /> {headline}</div>
    {#each displayRows as { position, row } (position)}
      <div class="podium-row">
        <span class="podium-pos">{POS_LABEL[position]}</span>
        {#if row}
          <strong class="podium-name">{who(row.names)}</strong>
          {#if row.prize != null}
            <span class="podium-prize">{fmtMoney(row.prize, currency)}{row.names.length > 1 ? ' c/u' : ''}</span>
          {/if}
        {:else}
          <span class="podium-placeholder">— aún en juego</span>
        {/if}
      </div>
    {/each}
    <div class="stakes-line">Pase lo que pase — es matemático.</div>
  </section>
{/if}
<!-- The two blocks are no longer mutually exclusive: "2nd and 3rd locked, 1st
     still in play" needs both. But once 1st is settled the lines are noise —
     both sides would name the same person. -->
{#if !stakes?.champions && decisive.length > 0}
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

  .podium-row {
    display: flex; align-items: baseline; gap: 8px;
    font-size: 14px; padding: 3px 0;
  }
  .podium-row + .podium-row { border-top: 1px solid rgba(201, 168, 76, 0.14); }
  .podium-pos {
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
    color: var(--text-muted); min-width: 24px;
  }
  .podium-name { color: var(--gold); }
  .podium-prize { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--green); }
  .podium-placeholder { color: var(--text-muted); }
  .decided .stakes-line { margin-top: 8px; font-size: 12px; color: var(--text-muted); }

  .stakes-match { display: flex; flex-direction: column; gap: 4px; }
  .stakes-match + .stakes-match { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(201, 168, 76, 0.2); }
  .stakes-phase { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
  .stakes-sides { display: flex; flex-direction: column; gap: 3px; }
  .stakes-side { font-size: 13px; color: var(--text); line-height: 1.45; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .stakes-side strong { color: var(--gold); }
  .stakes-side :global(img) { width: 16px; height: auto; border-radius: 2px; vertical-align: middle; }
</style>
