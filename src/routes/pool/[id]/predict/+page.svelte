<script>
  let { data } = $props();

  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const POSITION_LABELS = ['1st', '2nd', '3rd', '4th'];

  // selections[group] = { pos1: teamId|null, pos2: ..., pos3: ..., pos4: ... }
  let selections = $state({});

  $effect(() => {
    const sel = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      sel[group] = {
        pos1: existing.pos1 ?? null,
        pos2: existing.pos2 ?? null,
        pos3: existing.pos3 ?? null,
        pos4: existing.pos4 ?? null,
      };
    }
    selections = sel;
  });

  let saving = $state(false);
  let saved = $state(false);

  // Set a team for a position, removing it from any other position in the same group
  function selectTeam(group, position, teamId) {
    const num = Number(teamId) || null;
    // Remove this team from any other position
    if (num !== null) {
      for (const pos of ['pos1', 'pos2', 'pos3', 'pos4']) {
        if (selections[group][pos] === num && pos !== position) {
          selections[group][pos] = null;
        }
      }
    }
    selections[group][position] = num;
  }

  async function savePredictions() {
    saving = true;
    saved = false;
    try {
      const res = await fetch('/api/predictions/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_id: data.predictionId,
          groups: selections,
        }),
      });
      if (res.ok) {
        saved = true;
        setTimeout(() => saved = false, 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      saving = false;
    }
  }

  function flagEmoji(code) {
    if (!code) return '';
    // Handle subdivision codes
    if (code === 'GB-ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (code === 'GB-SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    // ISO 3166-1 alpha-2 → flag emoji
    if (code.length !== 2) return '🏳️';
    const offset = 127397;
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + offset)).join('');
  }

  // Abbreviate team name smartly
  function shortName(name) {
    const map = {
      'United States': 'USA',
      'South Korea': 'S. Korea',
      'South Africa': 'S. Africa',
      'Ivory Coast': 'Ivory Coast',
      'New Zealand': 'N. Zealand',
      'Cape Verde': 'Cape Verde',
      'Czech Republic': 'Czechia',
      'Saudi Arabia': 'S. Arabia',
      'Bosnia and Herzegovina': 'Bosnia',
      'DR Congo': 'DR Congo',
      'North Macedonia': 'N. Macedonia',
    };
    return map[name] || name;
  }
</script>

<div>
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Back to pool
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Group Stage Predictions</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Predict the final standings for each group. Select 1st–4th place.
    </p>
    {#if data.isLocked}
      <div style="margin-top: 8px; padding: 8px 12px; background: rgba(255,77,106,0.1); border: 1px solid var(--red); border-radius: 6px; font-size: 10px; color: var(--red);">
        ⚠️ Predictions are locked — the deadline has passed.
      </div>
    {/if}
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;">
    {#each GROUP_NAMES as group}
      {@const groupTeams = data.teamsByGroup[group] || []}
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <!-- Group header -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--gold);">
            {group}
          </div>
          <span style="font-size: 10px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Group {group}</span>
        </div>

        <!-- Position selectors: 1st, 2nd, 3rd, 4th -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          {#each POSITION_LABELS as label, pi}
            {@const posKey = `pos${pi + 1}`}
            {@const selectedTeamId = selections[group]?.[posKey]}
            {@const selectedTeam = groupTeams.find(t => t.id === selectedTeamId)}
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 22px; font-size: 10px; font-weight: 600; color: {pi === 0 ? 'var(--gold)' : pi === 1 ? '#c0c0c0' : pi === 2 ? '#cd7f32' : 'var(--text-dim)'}; text-align: center;">
                {pi + 1}
              </div>
              <select
                disabled={data.isLocked}
                onchange={(e) => selectTeam(group, posKey, e.target.value)}
                style="flex: 1; padding: 6px 8px; font-size: 11px; text-align: left; background: rgba(0,0,0,0.3); {selectedTeam ? 'color: var(--text); border-color: rgba(201,168,76,0.3);' : 'color: var(--text-muted);'}"
              >
                <option value="">Select {label}</option>
                {#each groupTeams as team}
                  <option value={team.id} selected={selectedTeamId === team.id}>
                    {flagEmoji(team.flag_code)} {shortName(team.name)}
                  </option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Save button -->
  {#if !data.isLocked}
    <div style="margin-top: 24px; display: flex; gap: 12px; align-items: center;">
      <button
        class="btn-primary"
        disabled={saving}
        onclick={savePredictions}
      >
        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Predictions'}
      </button>
      {#if saved}
        <span style="font-size: 10px; color: var(--green);">Group predictions saved!</span>
      {/if}
    </div>
  {/if}
</div>
