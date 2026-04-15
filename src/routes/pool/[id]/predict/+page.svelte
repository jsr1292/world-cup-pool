<script>
  let { data } = $props();

  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const POSITION_LABELS = ['1st', '2nd', '3rd', '4th'];

  // Build initial state from existing predictions or defaults
  let selections = $state({});

  // Initialize selections reactively
  $effect(() => {
    const sel = {};
    for (const group of GROUP_NAMES) {
      const existing = data.existingGroupPreds?.[group] || {};
      const teamsInGroup = data.teamsByGroup[group] || [];
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
    // ISO 2-letter code → flag emoji via regional indicators
    const offset = 127397;
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + offset)).join('');
  }
</script>

<div>
  <a href="/pool/{data.pool.id}" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
    ← Back to pool
  </a>

  <div style="margin-bottom: 20px;">
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--gold);">Group Stage Predictions</h1>
    <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
      Predict the final group standings. Select 1st–4th for each group.
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
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <div style="width: 28px; height: 28px; background: rgba(201,168,76,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--gold);">
            {group}
          </div>
          <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase;">Group {group}</div>
        </div>

        <!-- Teams in group -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          {#each groupTeams as team}
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid var(--border);">
              <span style="font-size: 16px;">{flagEmoji(team.flag_code)}</span>
              <span style="font-size: 11px; flex: 1;">{team.name}</span>
              <select
                disabled={data.isLocked}
                onchange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  // Find current position for this team and clear it, then set new position
                  for (const pos of ['pos1','pos2','pos3','pos4']) {
                    if (selections[group][pos] === team.id && pos !== e.target.name) {
                      selections[group][pos] = null;
                    }
                  }
                  selections[group][e.target.name] = val;
                }}
                name="pos{groupTeams.indexOf(team) + 1}"
                style="width: auto; min-width: 60px; padding: 4px 6px; font-size: 10px; background: rgba(0,0,0,0.3);"
              >
                <option value="">—</option>
                {#each POSITION_LABELS as label, pi}
                  <option value={team.id}>{label}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>

        <!-- Position dropdowns for clarity, below each team -->
        <div style="margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; border-top: 1px solid var(--border); padding-top: 10px;">
          {#each POSITION_LABELS as label, pi}
            {@const selectedTeamId = selections[group]?.[`pos${pi+1}`]}
            {@const selectedTeam = groupTeams.find(t => t.id === selectedTeamId)}
            <div style="text-align: center;">
              <div style="font-size: 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 3px;">{label}</div>
              <select
                disabled={data.isLocked}
                name="pos{pi+1}"
                onchange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  selections[group][`pos${pi+1}`] = val;
                }}
                style="width: 100%; padding: 4px 2px; font-size: 9px; text-align: center; text-align-last: center; background: rgba(0,0,0,0.3); {
                  selectedTeam ? 'color: var(--gold); border-color: rgba(201,168,76,0.3);' : ''
                }"
              >
                <option value="">—</option>
                {#each groupTeams as team}
                  <option value={team.id} selected={selectedTeamId === team.id}>
                    {flagEmoji(team.flag_code)} {team.name.split(' ').slice(-1)[0]}
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
  <div style="margin-top: 24px; display: flex; gap: 12px; align-items: center;">
    <button
      class="btn-primary"
      disabled={saving || data.isLocked}
      onclick={savePredictions}
    >
      {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Predictions'}
    </button>
    {#if saved}
      <span style="font-size: 10px; color: var(--green);">Group predictions saved!</span>
    {/if}
  </div>
</div>
