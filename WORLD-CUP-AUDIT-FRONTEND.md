# World Cup Pool — Frontend/Svelte 5 Reactivity Audit (#3 of 6)

**Date:** 2026-05-27  
**Scope:** All 19 `.svelte` files — Svelte 5 runes, $effect lifecycle, reactive data flow, form state, event handlers, list rendering  
**Files audited:** `+layout.svelte`, `+page.svelte`, `admin/+page.svelte`, `pools/create/+page.svelte`, `pools/+page.svelte`, `leaderboard/+page.svelte`, `profile/+page.svelte`, `login/+page.svelte`, `join/+page.svelte`, `join/[code]/+page.svelte`, `s/[code]/+page.svelte`, `pool/[id]/+page.svelte`, `pool/[id]/admin/+page.svelte`, `pool/[id]/predict/+page.svelte`, `pool/[id]/bracket/+page.svelte`, `pool/[id]/results/+page.svelte`, `pool/[id]/summary/+page.svelte`, `PullToRefresh.svelte`

---

## Summary Table

| # | File | Severity | Category | Issue |
|---|------|----------|----------|-------|
| 1 | `predict/+page.svelte` | **HIGH** | Stale state | `selections` & `matchScores` not re-initialized on SvelteKit soft navigation |
| 2 | `predict/+page.svelte` | **HIGH** | Stale state | `pool` and `allowMultiple` frozen at component init, not reactive to `data` |
| 3 | `admin/+page.svelte` | **HIGH** | Non-reactive mutation | `creators` / `allUsers` are plain arrays — mutations don't trigger UI update |
| 4 | `bracket/+page.svelte` | **HIGH** | Stale derived | `getTeamPath()` reads `_teams` (non-reactive) — path highlighting stale after picks |
| 5 | `bracket/+page.svelte` | **HIGH** | Latent infinite recursion | `r16Label()` calls itself as fallback — stack overflow if label is missing |
| 6 | `bracket/+page.svelte` | **MEDIUM** | Reactivity anti-pattern | Version-counter pattern for `_teams`/`_picks` — fragile, JSON-clone on every pick |
| 7 | `bracket/+page.svelte` | **MEDIUM** | $effect lifecycle | `$effect(() => { loadTiebreaker(); })` — no dependency guard, async race on data change |
| 8 | `pool/[id]/results/+page.svelte` | **MEDIUM** | Broken UI control | `selectedEntry` select is bound but changing it does nothing (no navigation/reload) |
| 9 | `pool/[id]/admin/+page.svelte` | **MEDIUM** | Non-reactive mutation | `match.status = 'finished'` on non-`$state` prop — `isFinished` never updates |
| 10 | `bracket/+page.svelte` | **MEDIUM** | Timer leak | `autoSaveTimer` and `tieTimer` not cleared on component destroy |
| 11 | `predict/+page.svelte` | **MEDIUM** | Timer leak | `autoSaveTimer` and `matchSaveTimer` not cleared on component destroy |
| 12 | `predict/+page.svelte` | **MEDIUM** | Broken condition | `{#if allowMultiple && newEntryLabel !== undefined}` — form always visible |
| 13 | `pool/[id]/admin/+page.svelte` | **MEDIUM** | `{#each}` missing keys | `data.matches`, `filteredMembers` render without key — unnecessary DOM churn |
| 14 | `layout.svelte` | **LOW** | Redundant state | `currentPath` is `$state + $effect` mirror of `$page.url.pathname` |
| 15 | `layout.svelte` | **LOW** | Invalid HTML | `<a>` wrapping `<button>` in bottom nav — broken keyboard nav, event bubbling |
| 16 | `predict/+page.svelte` | **LOW** | Timer leak | `saved = false` timeout never cancelled — stale feedback on rapid saves |
| 17 | `pool/[id]/+page.svelte` | **LOW** | Dead code | `t.link` check in tab renderer — property never defined on any tab |
| 18 | `profile/+page.svelte` | **LOW** | SSR/hydration | `isDark` initialized with direct `document.*` access — flash on hydration |
| 19 | `pool/[id]/+page.svelte` | **LOW** | Stale init | `summaryEntry` initialized once from `data`, not reactive to predictions change |

---

## Detailed Findings

---

### 1. HIGH — `selections` and `matchScores` not re-initialized on soft navigation

**File:** `src/routes/pool/[id]/predict/+page.svelte` — Lines 41–51, 239–243

**Bug:** Both reactive stores are initialized with plain loops at component-creation time, reading `data.existingGroupPreds` and `data.existingMatchPreds`. When the user switches entries via `switchEntry()`, the code calls `goto(url, { invalidateAll: true })`. SvelteKit performs a **soft navigation**: `data` is updated reactively (old `existingGroupPreds` replaced by new entry's data), but the component is NOT remounted. `selections` and `matchScores` remain frozen on the first entry's data.

```js
// Lines 41–51 — initialization runs ONCE, never reacts to data changes
let _initSel = {};
for (const group of GROUP_NAMES) {
  const existing = data.existingGroupPreds?.[group] || {};  // stale after soft nav
  _initSel[group] = [existing.pos1 ?? null, ...];
}
let selections = $state(_initSel);

// Lines 239–243 — same problem
let _initMatchScores = {};
for (const [matchId, score] of Object.entries(data.existingMatchPreds || {})) {
  _initMatchScores[Number(matchId)] = { home: score.home_score, away: score.away_score };
}
let matchScores = $state(_initMatchScores);
```

After switching to a different entry the user will see — and auto-save! — the previous entry's group rankings into the newly selected entry.

**Fix:**
```js
// Replace static initialization with a $derived that resets whenever data changes
const selectionsInit = $derived.by(() => {
  const init = {};
  for (const group of GROUP_NAMES) {
    const existing = data.existingGroupPreds?.[group] || {};
    init[group] = [existing.pos1 ?? null, existing.pos2 ?? null, existing.pos3 ?? null, existing.pos4 ?? null];
  }
  return init;
});
let selections = $state(selectionsInit);

// Sync selections when the server data changes (entry switch)
$effect(() => {
  // Read selectionsInit to establish dependency
  const fresh = selectionsInit;
  selections = JSON.parse(JSON.stringify(fresh));
});

// Same pattern for matchScores
const matchScoresInit = $derived.by(() => {
  const init = {};
  for (const [matchId, score] of Object.entries(data.existingMatchPreds || {})) {
    init[Number(matchId)] = { home: score.home_score, away: score.away_score };
  }
  return init;
});
let matchScores = $state({});
$effect(() => { matchScores = JSON.parse(JSON.stringify(matchScoresInit)); });
```

---

### 2. HIGH — `pool` and `allowMultiple` frozen at component init

**File:** `src/routes/pool/[id]/predict/+page.svelte` — Lines 8–9

**Bug:**
```js
const pool = data.pool;                              // frozen reference
const allowMultiple = !!pool.allow_multiple_predictions; // frozen value
```
Both are extracted once at init. If an admin changes pool settings and SvelteKit invalidation propagates `data` to this component, `pool` points to the old object and `allowMultiple` retains the old boolean. Particularly visible for the deadline: `pool.deadline_group` is used in the countdown `$effect` at line 23, so the timer won't restart with the new deadline.

**Fix:**
```js
// Use data.pool directly in template, or make pool reactive
const pool = $derived(data.pool);
const allowMultiple = $derived(!!data.pool.allow_multiple_predictions);
```
Or simply use `data.pool` and `!!data.pool.allow_multiple_predictions` throughout the template, removing the `const` aliases.

---

### 3. HIGH — `creators` array is plain JS — mutations invisible to Svelte

**File:** `src/routes/admin/+page.svelte` — Lines 8–9, 44–47, 56–59

**Bug:**
```js
const creators = [...data.creators];  // plain array, not $state
let allUsers = [...data.allUsers];    // plain array, not $state
```
`addCreator` pushes into `creators`:
```js
if (user) creators.push(user);
```
`removeCreator` splices from it:
```js
creators.splice(idx, 1);
```
Because `creators` is not declared with `$state`, Svelte 5 has no knowledge of these mutations. The `{#each creators as creator}` block never re-renders. The creator list appears frozen — add and remove appear to fail silently.

`filteredUsers` is also derived from `allUsers` (via a `$derived`), but since `allUsers` is not `$state`, filtered users won't update either.

**Fix:**
```js
let creators = $state([...data.creators]);
let allUsers = $state([...data.allUsers]);
```

---

### 4. HIGH — `getTeamPath` reads `_teams` directly — team hover highlighting stale after picks

**File:** `src/routes/pool/[id]/bracket/+page.svelte` — Lines 379–413

**Bug:** `_teams` and `_picks` are plain JS objects (not `$state`). All reactivity flows through the `version` counter via:
```js
const teams = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_teams)); });
```
But `getTeamPath` reads `_teams` directly:
```js
function getTeamPath(teamId) {
  for (const round of ['r32', 'r16', 'qf', 'sf']) {
    const matches = _teams[round] || [];  // reads mutable plain object
    ...
  }
}
const teamPath = $derived(getTeamPath(hoveredTeam));
```
`teamPath` is derived from `hoveredTeam` (reactive) but `getTeamPath` reads `_teams` which Svelte cannot track. After making a pick (which calls `bump()` → `version++` → `teams` re-derives), `teamPath` does NOT recompute because `hoveredTeam` hasn't changed. Result: the user hovers a team, makes a pick, and the highlight path shows the team's old path from before the pick was applied.

**Fix:**
```js
// Read from the reactive `teams` snapshot, not _teams
function getTeamPath(teamId, teamsSnapshot) {
  for (const round of ['r32', 'r16', 'qf', 'sf']) {
    const matches = teamsSnapshot[round] || [];
    ...
  }
}
// Depend on both hoveredTeam and the reactive teams snapshot
const teamPath = $derived(getTeamPath(hoveredTeam, teams));
```

---

### 5. HIGH — `r16Label()` has infinite self-recursion as fallback

**File:** `src/routes/pool/[id]/bracket/+page.svelte` — Line 57

**Bug:**
```js
function r32Label(mi) { return R32_LABELS[mi] || `R32-${mi + 1}`; }  // correct
function r16Label(mi) { return R16_LABELS[mi] || r16Label(mi); }     // ← INFINITE RECURSION
function qfLabel(mi) { return QF_LABELS[mi] || `QF-${mi + 1}`; }    // correct
function sfLabel(mi) { return SF_LABELS[mi] || `SF-${mi + 1}`; }    // correct
```
`r16Label` was clearly copy-pasted from `r32Label` and the fallback string was not updated — it calls itself instead of returning `\`R16-${mi + 1}\``. If `R16_LABELS[mi]` is ever falsy (e.g., out-of-bounds index), this produces a stack overflow crash.

Currently `mi` is always within 0–7 and `R16_LABELS` has 8 entries, so this is latent. It will explode if a future refactor adds a 9th R16 match or passes an unexpected index.

**Fix:**
```js
function r16Label(mi) { return R16_LABELS[mi] || `R16-${mi + 1}`; }
```

---

### 6. MEDIUM — Version-counter anti-pattern for bracket state

**File:** `src/routes/pool/[id]/bracket/+page.svelte` — Lines 126–133, 205–206

**Bug:**
```js
let version = $state(0);
let _teams = {};   // plain object — NOT reactive
let _picks = {};   // plain object — NOT reactive
function bump() { version++; }

const teams = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_teams)); });
const explicitPicks = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_picks)); });
```
Every user action (pick, cascade, init) must call `bump()` or the UI silently stays stale. The pattern also performs a **full deep clone** of all bracket data on every pick — 16 R32 + 8 R16 + 4 QF + 2 SF + 1 Final + 1 3rd = 64 slots, cloned twice (teams + picks), on every keystroke/click.

Any code path that mutates `_teams`/`_picks` without calling `bump()` (e.g., `recascade()` called without `bump()` after `loadTiebreaker()`) will silently show stale UI.

**Fix:** Make `_teams` and `_picks` deeply reactive with `$state`:
```js
let _teams = $state({});
let _picks = $state({});
// Remove version, remove JSON.parse/stringify clones
// Access _teams and _picks directly in template and derived
const teams = $derived(_teams);          // Svelte 5 tracks fine-grained reads
const explicitPicks = $derived(_picks);
```
Remove `bump()` calls — Svelte 5 will react to fine-grained property mutations automatically.

---

### 7. MEDIUM — `$effect(() => { loadTiebreaker(); })` — missing cleanup, async race

**File:** `src/routes/pool/[id]/bracket/+page.svelte` — Line 366

**Bug:**
```js
$effect(() => { loadTiebreaker(); });
```
Two issues:

1. **No cleanup returned.** `loadTiebreaker` is async and sets `tieHome`/`tieAway`. If `data.selectedId` changes while a fetch is in flight, a second call starts before the first completes. The first response may arrive after the second, silently overwriting the correct values with stale ones.

2. **Effect fires on every reactive dependency change.** The effect body calls `loadTiebreaker()` which reads `data.selectedId`. Any other change to `data` could also re-trigger the effect. With the bracket page using `window.location.href` for entry switches (full reload), this is masked, but it's brittle.

**Fix:**
```js
$effect(() => {
  const id = data.selectedId;
  if (!id) return;
  let cancelled = false;
  (async () => {
    try {
      const r = await fetch(`/api/predictions/tiebreaker?prediction_id=${id}`);
      if (!cancelled && r.ok) {
        const d = await r.json();
        tieHome = d.home_score;
        tieAway = d.away_score;
      }
    } catch {}
  })();
  return () => { cancelled = true; };
});
```

---

### 8. MEDIUM — `selectedEntry` select in results page does nothing

**File:** `src/routes/pool/[id]/results/+page.svelte` — Lines 5, 101–105

**Bug:**
```js
let selectedEntry = $state(data.selectedEntryId);
```
```svelte
<select bind:value={selectedEntry} ...>
  {#each data.userPredictions as pred}
    <option value={pred.id}>...</option>
  {/each}
</select>
```
The select is bound to `selectedEntry` which changes when the user picks a different entry. However, there is **no `$effect`, no `onchange` handler, and no navigation** triggered by the change. The `bracketLookup` and `groupPredLookup` objects are built from `data.userBracketPreds` and `data.userGroupPreds` (server-loaded for `data.selectedEntryId`) at component init and never change. The user can click the dropdown to select another entry, but the displayed predictions remain those of the original entry.

Compare to `predict/+page.svelte` which correctly uses `goto()` on entry change.

**Fix:**
```js
// Option A: navigate on change (server re-fetches data for new entry)
async function switchEntry(id) {
  const url = new URL($page.url);
  url.searchParams.set('entry_id', id);
  await goto(url.pathname + url.search, { invalidateAll: true });
}
```
```svelte
<select bind:value={selectedEntry} onchange={(e) => switchEntry(Number(e.target.value))}>
```
Then update the server `+page.server.ts` to accept `entry_id` param and load appropriate data.

---

### 9. MEDIUM — Direct mutation of `match` object from props — `isFinished` never updates

**File:** `src/routes/pool/[id]/admin/+page.svelte` — Lines 432–447

**Bug:**
```js
onclick={async () => {
  // ...
  if (res.ok) { match.status = 'finished'; match.home_score = hs; match.away_score = as2; }
}}
```
`match` is an element of `data.matches`. `data` comes from `$props()`. In Svelte 5, `$props()` wraps the received value reactively, but individual objects _within_ the prop array (such as `match`) are plain objects unless the parent used `$state`. Mutating `match.status` on a plain object does not notify Svelte's reactivity system.

The template uses `{@const isFinished = match.status === 'finished'}` which is re-evaluated only when the `{#each}` block re-renders. Since nothing signals a re-render, the Save button's style and the input's placeholder (`'-'` vs score) remain stale after saving.

**Fix:**
```js
// Maintain a local reactive copy of matches
let localMatches = $state(data.matches.map(m => ({ ...m })));

// In the onclick handler:
if (res.ok) {
  const idx = localMatches.findIndex(m => m.id === match.id);
  if (idx >= 0) {
    localMatches[idx] = { ...localMatches[idx], status: 'finished', home_score: hs, away_score: as2 };
  }
}
```
```svelte
{#each localMatches as match}
```

---

### 10. MEDIUM — Auto-save timers in bracket page not cleaned up on destroy

**File:** `src/routes/pool/[id]/bracket/+page.svelte` — Lines 318–322, 342–346, 366

**Bug:**
```js
let autoSaveTimer = null;
function autoSaveBracket() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveBracket, 800);
}

let tieTimer = null;
function onTieInput() {
  if (tieTimer) clearTimeout(tieTimer);
  tieTimer = setTimeout(saveTiebreaker, 800);
}
```
Neither timer is cancelled when the component is destroyed (e.g., user navigates away). The bracket page uses `window.location.href` for entry switching (full reload), but standard SvelteKit navigation to another route destroys the component. If the user:
1. Makes a bracket pick → timer starts (800ms)
2. Immediately navigates away (< 800ms)

The `saveBracket` fetch fires for a destroyed component, potentially saving stale data or causing errors.

**Fix:**
```js
$effect(() => {
  return () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (tieTimer) clearTimeout(tieTimer);
  };
});
```

---

### 11. MEDIUM — Auto-save timers in predict page not cleaned up on destroy

**File:** `src/routes/pool/[id]/predict/+page.svelte` — Lines 175–179, 248–251

**Bug:** Same pattern as #10. `autoSaveTimer` and `matchSaveTimer` are plain `let` variables, not cleaned up on component destroy.

```js
let autoSaveTimer = null;    // not cleaned up
let matchSaveTimer = null;   // not cleaned up
```

**Fix:**
```js
$effect(() => {
  return () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (matchSaveTimer) clearTimeout(matchSaveTimer);
  };
});
```

---

### 12. MEDIUM — New entry form always visible when `allowMultiple`

**File:** `src/routes/pool/[id]/predict/+page.svelte` — Line 398

**Bug:**
```svelte
{#if allowMultiple && newEntryLabel !== undefined}
```
`newEntryLabel` is `$state('')` — a string is never `undefined`. The condition is equivalent to `{#if allowMultiple}`, so the "Nueva entrada" form is always rendered when the pool allows multiple predictions, even before the user clicks the "+ Nueva entrada" button.

Compare to `bracket/+page.svelte` line 554 which correctly uses `newEntryLabel !== ''`.

The cancel button (`onclick={() => { newEntryLabel = ''; createMsg = ''; }}`) sets the label to `''`, which would hide the form in bracket but has no effect here because the condition checks `!== undefined` not `!== ''`.

**Fix:**
```js
let showCreateEntry = $state(false);
```
```svelte
<!-- Show button -->
<button onclick={() => { showCreateEntry = true; newEntryLabel = ''; }}>+ Nueva entrada</button>

<!-- Form -->
{#if allowMultiple && showCreateEntry}
  ...
  <!-- Cancel button -->
  <button onclick={() => { showCreateEntry = false; newEntryLabel = ''; createMsg = ''; }}>✕</button>
{/if}
```

---

### 13. MEDIUM — `{#each}` blocks missing key props — unnecessary DOM churn

**File:** `src/routes/pool/[id]/admin/+page.svelte` — Lines 371, 407

**Bug:**
```svelte
{#each filteredMembers as member}       <!-- no key -->
{#each data.matches as match}           <!-- no key -->
```
Without a key, Svelte uses index-based reconciliation. When `filteredMembers` changes (user types in search box), Svelte patches each DOM node in-place rather than efficiently reusing/discarding. Input values bound with `value=...` (not `bind:value`) can persist from the wrong row. The match score inputs could show a previous match's values transiently during re-render.

Also affected: `{#each data.leaderboard as entry, i}` in `pool/[id]/+page.svelte` line 297 has no key.

**Fix:**
```svelte
{#each filteredMembers as member (member.entry_id ?? member.od_user_id)}
{#each data.matches as match (match.id)}
{#each data.leaderboard as entry (entry.user_id + ':' + (entry.label || ''))}
```

---

### 14. LOW — `currentPath` should be `$derived`, not `$state + $effect`

**File:** `src/routes/+layout.svelte` — Lines 18–21

**Bug:**
```js
let currentPath = $state('');
$effect(() => {
  currentPath = $page.url.pathname;
});
```
This is the classic Svelte 4 → 5 migration redundancy. `currentPath` is a reactive variable that immediately mirrors `$page.url.pathname`. The `$effect` adds an extra reactive subscription, a round-trip through the scheduler, and makes the initial value `''` briefly visible on first render (until the effect fires post-mount).

**Fix:**
```js
const currentPath = $derived($page.url.pathname);
```

---

### 15. LOW — `<a>` wrapping `<button>` in bottom navigation — invalid HTML

**File:** `src/routes/+layout.svelte` — Lines 205–210

**Bug:**
```svelte
{#each navItems as item}
  <a href={item.path}>
    <button class:active={isActive(item.path)} onclick={() => { try { navigator.vibrate(5); } catch {} }}>
```
`<button>` inside `<a>` is **invalid HTML** (interactive content inside interactive content). Browser behavior is undefined: some browsers intercept the `<a>` click before the `<button>`, some do the reverse. Keyboard navigation (Tab, Enter, Space) may not work correctly. The `onclick` on the button and the `href` on the `<a>` can fire in conflicting order.

**Fix:** Use a single element:
```svelte
{#each navItems as item}
  <a href={item.path}
     class="bottom-nav-item"
     class:active={isActive(item.path)}
     onclick={() => { try { navigator.vibrate(5); } catch {} }}>
    <svg class="nav-icon-mobile"><use href="/icon.svg#{item.icon}" /></svg>
    <span class="nav-label">{item.label}</span>
  </a>
{/each}
```

---

### 16. LOW — `saved = false` timeout not cancelled on new save

**File:** `src/routes/pool/[id]/predict/+page.svelte` — Lines 201, 267

**Bug:**
```js
if (res.ok) { saved = true; setTimeout(() => saved = false, 2000); }
```
If the user triggers two saves within 2 seconds (rapid group selection changes), both save operations can succeed. Each sets `saved = true` then schedules `saved = false` 2 seconds later. The first timeout fires and clears `saved` while the second save's confirmation is still showing, creating a visible flicker from "✓ Guardado" → (blank) → "✓ Guardado".

Same issue on line 267 for `matchSaved`.

**Fix:**
```js
let savedTimer = null;
// In savePredictions:
if (res.ok) {
  if (savedTimer) clearTimeout(savedTimer);
  saved = true;
  savedTimer = setTimeout(() => { saved = false; savedTimer = null; }, 2000);
}
```

---

### 17. LOW — Dead code: `t.link` check in pool tabs renderer

**File:** `src/routes/pool/[id]/+page.svelte` — Lines 220–229

**Bug:**
```js
const tabs = [
  { id: 'predictions', label: 'Pronósticos' },
  { id: 'leaderboard', label: 'Clasificación' },
  { id: 'members', label: 'Miembros' },
  { id: 'summary', label: '📋 Resumen' },
  { id: 'results', label: '🏆 Resultados' },
  { id: 'scoring', label: 'Puntuación' },
];
```
```svelte
{#if t.link}
  <a href="/pool/{pool.id}/{t.id}" ...>   <!-- never reached -->
```
No tab has a `link` property. The `{#if t.link}` branch is dead code. The `<a>` path (`class:active={false}`) would never highlight the active tab anyway.

**Fix:** Remove the dead branch:
```svelte
{#each tabs as t}
  <button onclick={() => switchTab(t.id)} class="pool-tab" class:active={tab === t.id}>
    {t.label}
  </button>
{/each}
```

---

### 18. LOW — `isDark` initialized with DOM access during SSR

**File:** `src/routes/profile/+page.svelte` — Line 11

**Bug:**
```js
let isDark = $state(
  typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light'
);
```
This reads `document.documentElement` inline as the `$state` initializer. During SSR, `typeof window !== 'undefined'` is `false`, so `isDark` is initialized to `false`. On the client, the hydrated component starts with `isDark = false` regardless of the actual theme. If the user has dark mode (the default), there is a hydration mismatch — the SSR HTML renders with `isDark = true` styles but the client hydrates with `false`.

Contrast with `+layout.svelte` which correctly uses `$state(true)` as the safe SSR default and then reads the DOM in a `$effect` (browser-only).

**Fix:**
```js
let isDark = $state(true);  // SSR-safe default matches the CSS default
$effect(() => {
  isDark = document.documentElement.getAttribute('data-theme') !== 'light';
});
```

---

### 19. LOW — `summaryEntry` initialized once, not reactive to predictions change

**File:** `src/routes/pool/[id]/+page.svelte` — Line 18

**Bug:**
```js
let summaryEntry = $state(data.predictions.length > 0 ? data.predictions[0].id : null);
```
If `data.predictions` is empty on first load (no predictions yet) and the user later creates a prediction (via another tab), `summaryEntry` remains `null` even after SvelteKit invalidation repopulates `data.predictions`. The Summary tab would show "No tienes predicciones aún" even though predictions exist.

**Fix:**
```js
const summaryEntry = $derived(data.predictions.length > 0 ? data.predictions[0].id : null);
```
Or if user-selection is needed, sync in a `$effect`:
```js
let summaryEntry = $state(null);
$effect(() => {
  if (data.predictions.length > 0 && !summaryEntry) {
    summaryEntry = data.predictions[0].id;
  }
});
```

---

## Patterns Needing Systematic Attention

### Pattern A: Non-reactive plain objects used as mutable state
**Appears in:** `bracket/+page.svelte` (`_teams`, `_picks`), `admin/+page.svelte` (`creators`, `allUsers`, `_scoring`, `_members`)

The version-counter workaround (`let version = $state(0)` + `void version` in deriveds) is a valid escape hatch but must be applied consistently — any mutation of `_teams` without `bump()` causes stale UI. The correct Svelte 5 pattern is `$state` with fine-grained reactivity.

### Pattern B: Component state not re-synchronized on `data` prop update
**Appears in:** `predict/+page.svelte` (`selections`, `matchScores`, `pool`, `allowMultiple`), `pool/[id]/+page.svelte` (`summaryEntry`)

After `goto(..., { invalidateAll: true })`, `data` updates but plain `let` / `const` variables computed from `data` at init time remain stale. Always use `$derived` for values derived from `data`, or use `$effect` to sync `$state` when `data` changes.

### Pattern C: Auto-save timers without destroy cleanup
**Appears in:** `predict/+page.svelte`, `bracket/+page.svelte`

All debounced save timers should be registered in a `$effect` that returns a cleanup function, or at minimum wrapped in a single cleanup `$effect`:
```js
$effect(() => {
  return () => {
    [autoSaveTimer, matchSaveTimer, tieTimer].forEach(t => { if (t) clearTimeout(t); });
  };
});
```

### Pattern D: `{#each}` without key
Missing keys on dynamically filtered/sorted lists (`filteredMembers`, leaderboard). Always provide a stable, unique key for lists that can reorder or filter.

---

## Reactivity Correctness Scorecard

| Area | Score | Notes |
|------|-------|-------|
| $state / $derived correctness | 6/10 | Version-counter anti-pattern; stale inits |
| $effect lifecycle | 6/10 | Timer leaks; tiebreaker async race |
| Reactive data flow (invalidation) | 5/10 | `selections`, `matchScores` stale on soft nav |
| Form state management | 7/10 | Auto-save debounce OK; minor timer leaks |
| Svelte 5 migration | 8/10 | No `$:` declarations found; runes used throughout |
| Event handler reactivity | 8/10 | Handlers clean; stale `pool` const is minor |
| Conditional rendering | 9/10 | No major unmount/remount issues |
| List rendering (keys) | 6/10 | Several `{#each}` without keys |
