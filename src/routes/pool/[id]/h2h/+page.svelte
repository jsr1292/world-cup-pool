<script lang="ts">
  import { goto } from '$app/navigation';
  import { flagEmoji, shortName } from '$lib/teams.js';
  let { data } = $props();

  const teams = $derived(data.teams as Record<number, { name?: string; flag_code?: string }>);
  function tName(id: number | null) { const n = id != null ? teams[id]?.name : null; return n ? shortName(n) : '—'; }
  function tFlag(id: number | null) { return id != null ? flagEmoji(teams[id]?.flag_code || '') : ''; }
  const entryLabel = (e: any) => `${e.display_name}${data.pool.allow_multiple_predictions && e.label ? ` · ${e.label}` : ''}`;

  let aSel = $state(data.a?.id ? String(data.a.id) : '');
  let bSel = $state(data.b?.id ? String(data.b.id) : '');
  function reload() { if (aSel && bSel && aSel !== bSel) goto(`?a=${aSel}&b=${bSel}`, { invalidateAll: true }); }

  const groups = 'ABCDEFGHIJKL'.split('');
  // Agreement count across champion + group winners (the comparable single-pick fields).
  const agreement = $derived.by(() => {
    if (!data.a || !data.b) return null;
    let same = 0, total = 0;
    total++; if (data.a.champion != null && data.a.champion === data.b.champion) same++;
    for (const g of groups) { total++; const av = data.a.groupWinners[g], bv = data.b.groupWinners[g]; if (av != null && av === bv) same++; }
    return { same, total };
  });
  const sharedFinalists = $derived.by(() => {
    if (!data.a || !data.b) return 0;
    const bs = new Set(data.b.finalists);
    return data.a.finalists.filter((t: number) => bs.has(t)).length;
  });
</script>

<svelte:head><title>Comparar · {data.pool.name}</title></svelte:head>

<div style="max-width: 560px; margin: 0 auto; padding: 16px;">
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; gap: 4px; margin-bottom: 12px;">← {data.pool.name}</a>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 22px; color: var(--gold); margin-bottom: 12px;">⚔️ Comparar</h1>

  {#if !data.betsLocked}
    <div style="padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
      <p style="font-size: 12px; color: var(--text-muted);">Disponible cuando se cierren las apuestas.</p>
    </div>
  {:else}
    <!-- Selectors -->
    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 16px;">
      <select bind:value={aSel} onchange={reload} style="flex: 1; min-width: 0; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 8px; color: var(--text);">
        <option value="">Elige…</option>
        {#each data.entries as e}<option value={String(e.id)}>{entryLabel(e)}</option>{/each}
      </select>
      <span style="font-size: 12px; color: var(--text-dim);">vs</span>
      <select bind:value={bSel} onchange={reload} style="flex: 1; min-width: 0; font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 8px; color: var(--text);">
        <option value="">Elige…</option>
        {#each data.entries as e}<option value={String(e.id)}>{entryLabel(e)}</option>{/each}
      </select>
    </div>

    {#if !data.a || !data.b}
      <p style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 20px;">Elige dos participantes para comparar sus pronósticos.</p>
    {:else}
      {#if agreement}
        <div style="text-align: center; margin-bottom: 16px; padding: 10px; background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.22); border-radius: 10px;">
          <div style="font-size: 20px; font-weight: 800; color: var(--gold);">{agreement.same}/{agreement.total}</div>
          <div style="font-size: 10px; color: var(--text-muted);">coincidencias (campeón + ganadores de grupo) · {sharedFinalists}/2 finalistas en común</div>
        </div>
      {/if}

      {#snippet row(label: string, av: number | null, bv: number | null)}
        {@const same = av != null && av === bv}
        <div style="display: flex; align-items: center; gap: 6px; padding: 7px 8px; background: {same ? 'rgba(0,229,160,0.05)' : 'var(--bg-card)'}; border: 1px solid {same ? 'rgba(0,229,160,0.2)' : 'var(--border)'}; border-radius: 6px;">
          <span style="flex: 1; min-width: 0; font-size: 11px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {same ? 'font-weight: 600;' : ''}">{tName(av)} {@html tFlag(av)}</span>
          <span style="font-size: 8px; color: var(--text-dim); width: 46px; text-align: center; flex-shrink: 0; text-transform: uppercase;">{label}</span>
          <span style="flex: 1; min-width: 0; font-size: 11px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; {same ? 'font-weight: 600;' : ''}">{@html tFlag(bv)} {tName(bv)}</span>
          <span style="width: 12px; flex-shrink: 0; text-align: center; font-size: 11px; color: {same ? 'var(--green)' : 'var(--text-dim)'};">{same ? '=' : '≠'}</span>
        </div>
      {/snippet}

      <!-- Names header -->
      <div style="display: flex; gap: 6px; margin-bottom: 8px; padding: 0 8px;">
        <span style="flex: 1; font-size: 11px; font-weight: 700; color: var(--gold); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{data.a.owner}{#if data.a.label} · {data.a.label}{/if}</span>
        <span style="width: 46px;"></span>
        <span style="flex: 1; font-size: 11px; font-weight: 700; color: var(--gold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{data.b.owner}{#if data.b.label} · {data.b.label}{/if}</span>
        <span style="width: 12px;"></span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        {@render row('Campeón', data.a.champion, data.b.champion)}
        {#each groups as g}
          {@render row(`1.º ${g}`, data.a.groupWinners[g] ?? null, data.b.groupWinners[g] ?? null)}
        {/each}
      </div>

      <!-- Finalists + tiebreaker -->
      <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
          <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Finalistas · {data.a.owner.split(' ')[0]}</div>
          {#each data.a.finalists as t}<div style="font-size: 11px;">{@html tFlag(t)} {tName(t)}</div>{/each}
          {#if data.a.tiebreaker}<div style="font-size: 9px; color: var(--text-dim); margin-top: 6px;">Final: {data.a.tiebreaker.home}-{data.a.tiebreaker.away}</div>{/if}
        </div>
        <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
          <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Finalistas · {data.b.owner.split(' ')[0]}</div>
          {#each data.b.finalists as t}<div style="font-size: 11px;">{@html tFlag(t)} {tName(t)}</div>{/each}
          {#if data.b.tiebreaker}<div style="font-size: 9px; color: var(--text-dim); margin-top: 6px;">Final: {data.b.tiebreaker.home}-{data.b.tiebreaker.away}</div>{/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
