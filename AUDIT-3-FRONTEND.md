# Audit #3 — Frontend / Reactivity / UI
**Date:** 2026-05-27  
**Scope:** All `.svelte`, `+page.server.ts` (as data sources), `app.css`  
**Files read:** 19 Svelte components, 1 CSS file, 1 stores file

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH     | 7 |
| MEDIUM   | 10 |
| LOW      | 8 |

---

## CRITICAL

---

### C-1 — `app.css` line 2: `--bg2` undefined → skeleton shimmer transparent, bottom sheet invisible

**File:** `src/app.css:2`, `src/app.css:479`  
**Category:** UI-UX / DESIGN

`--bg2` is used in both the `.skeleton` shimmer gradient and the `.bottom-sheet` background, but it is **never defined** in `:root` or `:root[data-theme="light"]`. Per CSS spec, a `var()` referencing an undefined property makes the whole declaration invalid-at-computed-value-time; the browser uses the property's initial value (`transparent` for `background`).

**Impact:**
- All skeleton loading placeholders (`<div class="skeleton">`) render as transparent boxes — no shimmer effect is visible anywhere in the app.
- The bottom sheet used in `pool/[id]/+page.svelte` has a transparent background, making it a see-through overlay.

```css
/* app.css line 2 — --bg2 never defined */
.skeleton {
  background: linear-gradient(90deg, var(--bg2) 25%, var(--bg3, #1a1d26) 50%, var(--bg2) 75%);
  ...
}

/* app.css line 479 */
.bottom-sheet { background: var(--bg2); ... }
```

**Fix:** Add the missing variables to both themes in `app.css`:
```css
:root {
  /* Add these */
  --bg2: #0d1120;
  --bg3: #1a1d26;
}

:root[data-theme="light"] {
  /* Add these */
  --bg2: #e8e8e4;
  --bg3: #f0f0ec;
}
```

---

### C-2 — `bracket/+page.svelte` line 1582: `--bg-primary` and `--text-primary` undefined → 3rd-place team buttons invisible

**File:** `src/routes/pool/[id]/bracket/+page.svelte:1582-1587`  
**Category:** DESIGN / UI-UX

The `.third-team-btn` CSS class uses `var(--bg-primary)` and `var(--text-primary)`, neither of which is defined anywhere in the design system. The 3rd-place team selector modal (used for picking which 3rd-place qualifier advances in the R32 bracket) will show buttons with transparent backgrounds.

```css
.third-team-btn {
  background: var(--bg-primary);    /* undefined → transparent */
  border: 1px solid var(--border);
  color: var(--text-primary);       /* undefined → inherits body color, readable but unintended */
}
```

**Fix:**
```css
.third-team-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text);
}
```

---

### C-3 — `results/+page.svelte` line 5: Entry selector `<select>` is non-functional — changing selection doesn't update data

**File:** `src/routes/pool/[id]/results/+page.svelte:5`, `src/routes/pool/[id]/results/+page.svelte:101`  
**Category:** REACTIVITY / UI-UX

`selectedEntry` is bound to the `<select>` element, but **all the prediction lookups** (`bracketLookup`, `groupPredLookup`, `matchPredLookup`) are computed once at module initialization from `data.userBracketPreds`, `data.userGroupPreds`, and `data.userMatchPreds`. They are plain `const` objects, not `$derived`. Changing `selectedEntry` via the dropdown has zero effect on the displayed predictions.

```js
// Line 25-28: Built once, never re-derived
const bracketLookup: Record<...> = {};
for (const bp of data.userBracketPreds) {  // data is always entry 0's data
  bracketLookup[bp.phase][bp.match_index] = ...;
}
```

The corresponding server file (`+page.server.ts`) presumably filters by `selectedEntryId`, but the client never reloads when `selectedEntry` changes.

**Fix:** Either:
1. Make switching entries perform a server navigation (`goto(url, { invalidateAll: true })`), as done in `predict/+page.svelte`, or
2. Pass all entries' predictions as keyed objects and derive lookups from `selectedEntry` using `$derived.by()`.

---

### C-4 — `+layout.svelte` line 120-124: SSR-rendered `typeof window !== 'undefined'` comparison in template

**File:** `src/routes/+layout.svelte:120-124`  
**Category:** REACTIVITY / UI-UX

Inside the Svelte template (not inside `$effect` or `onMount`), there is a `typeof window !== 'undefined'` check in an `{:else if}` block:

```svelte
{:else if typeof window !== 'undefined'}
  {@const diff = new Date('2026-06-11T00:00:00Z').getTime() - Date.now()}
  {#if diff > -(1000 * 60 * 60 * 24 * 35)}
    <div class="countdown live">⚽ En juego</div>
  {/if}
{/if}
```

During SSR, `typeof window !== 'undefined'` is `false`, so this branch is skipped server-side. On client hydration, if `countdownText` is empty and `window` is available, the "En juego" badge appears — but the server rendered nothing there, causing a **hydration mismatch**. SvelteKit will log a warning and may silently patch the DOM, but this is a bug in principle.

**Fix:** Move the "En juego" check into a `$derived` that only runs client-side, or use the `browser` import:
```svelte
{:else if browser}
  <!-- safe: only runs in browser -->
```

---

## HIGH

---

### H-1 — `+layout.svelte` line 29-33 + `app.html`/`<head>`: Theme FOUC — no blocking theme-init script

**File:** `src/routes/+layout.svelte:29-33`  
**Category:** UI-UX / DESIGN

The theme is initialized via a `$effect` in `+layout.svelte`:
```js
let isDark = $state(true);  // Always starts as dark
$effect(() => {
  if (!browser) return;
  isDark = document.documentElement.getAttribute('data-theme') !== 'light';
});
```

The `$effect` runs **after hydration**, not before first paint. Any user with a saved `light` theme will see a full-page flash from dark to light on every navigation. The correct approach is a `<script>` tag in `<head>` (in `app.html`) that reads `localStorage` and sets `data-theme` synchronously before any rendering.

**Fix:** Add to `src/app.html` inside `<head>` before the body:
```html
<script>
  (function() {
    const t = localStorage.getItem('theme');
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  })();
</script>
```

---

### H-2 — `+layout.svelte` line 18-21: `currentPath` should be `$derived`, not `$state + $effect`

**File:** `src/routes/+layout.svelte:18-21`  
**Category:** REACTIVITY

```js
let currentPath = $state('');
$effect(() => {
  currentPath = $page.url.pathname;
});
```

`currentPath` is synchronously derivable from `$page`. Using `$state + $effect` introduces a one-tick delay: on navigation, `currentPath` is stale for one frame before the `$effect` fires. This means `isActive()` briefly returns wrong results, causing the active nav item to flicker.

**Fix:**
```js
const currentPath = $derived($page.url.pathname);
```

---

### H-3 — `+layout.svelte` line 94: Mixes legacy `page.subscribe()` with rune-style `$page` auto-subscription

**File:** `src/routes/+layout.svelte:94`  
**Category:** REACTIVITY

The file uses `$page.url.pathname` (auto-subscription via rune-style) in the `$effect` at line 20, AND calls `page.subscribe()` manually inside `onMount` at line 94:

```js
// Line 6: imports the store
import { page } from '$app/stores';

// Line 20: uses rune-style auto-subscription
$effect(() => { currentPath = $page.url.pathname; });

// Line 94: also manually subscribes inside onMount
const unsubscribe = page.subscribe(() => setTimeout(stagger, 100));
```

This creates two subscriptions to the same store with different patterns. In Svelte 5 / SvelteKit 2, the canonical approach for reactive store access is to import from `'$app/state'` and use the value directly (no `$` prefix needed), or use a `$effect`. Mixing patterns risks subtle bugs if the subscription order or cleanup differs.

**Fix for the stagger re-run on navigation:** Use a single reactive source:
```js
// Remove the manual subscribe, replace with $effect
$effect(() => {
  $page; // reactive dependency
  setTimeout(stagger, 100);
});
```

---

### H-4 — `profile/+page.svelte` line 11-26: Duplicate theme toggle out-of-sync with layout

**File:** `src/routes/profile/+page.svelte:11-26`  
**Category:** UI-UX / REACTIVITY

`profile/+page.svelte` implements its own `isDark` state and `toggleTheme()`, duplicating the logic from `+layout.svelte`. The profile's `isDark` is initialized at module-parse time (not in `$effect`/`onMount`), which is fine in Svelte 5 because `$state` is valid at module level, but it reads the DOM synchronously:

```js
let isDark = $state(typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light');
```

During SSR, this evaluates to `false` (light mode), so the toggle button starts wrong. After hydration, the layout's own `isDark` `$effect` runs and updates its copy, but the profile's copy stays stale.

**Consequence:** On the profile page, if you toggle the theme, the DOM changes (via `document.documentElement.setAttribute`) but the layout's `isDark` state doesn't update, so the top-bar theme button shows the wrong icon until page refresh.

**Fix:** Remove the profile's `isDark`/`toggleTheme` and use a shared store or let the layout own the theme. At minimum, read from the DOM in `$effect`:
```js
let isDark = $state(false); // will be corrected after mount
$effect(() => {
  isDark = document.documentElement.getAttribute('data-theme') !== 'light';
});
```

---

### H-5 — `pool/[id]/admin/+page.svelte` line 451-453: Score inputs read via `document.querySelector` rather than reactive binding

**File:** `src/routes/pool/[id]/admin/+page.svelte:451-453`  
**Category:** REACTIVITY / UI-UX

The "Save" button for match results reads input values via DOM querying instead of bound state:

```js
const row = document.querySelector(`[data-match-id="${match.id}"][data-side="home"]`);
const row2 = document.querySelector(`[data-match-id="${match.id}"][data-side="away"]`);
const hs = Number(row?.value);
const as2 = Number(row2?.value);
```

If the DOM query returns `null` (e.g., the element is off-screen or re-rendered), the save silently does nothing (`isNaN(null) === true`). There's no error feedback shown to the admin.

**Fix:** Bind each input to the `localMatches` array:
```svelte
<input type="number" min="0"
  bind:value={match.home_score}
  placeholder="-"
  style="width: 40px; text-align: center; padding: 4px;"
/>
```
Then in the onclick handler read directly from `match.home_score` and `match.away_score`.

---

### H-6 — `+layout.svelte` line 202-212: `<a>` wrapping `<button>` is invalid HTML

**File:** `src/routes/+layout.svelte:202-212`  
**Category:** UI-UX / ACCESSIBILITY

```svelte
{#each navItems as item}
  <a href={item.path}>
    <button class:active={isActive(item.path)} onclick={...}>
```

Per HTML spec, interactive elements (`<button>`) cannot be nested inside `<a>` elements. While browsers render this, it causes:
- Unpredictable keyboard navigation (Tab order duplicated)
- Screen readers announce both the link and the button
- The `onclick` vibration handler fires separately from the `href` navigation

**Fix:** Replace with a styled `<a>` that has button-like behavior:
```svelte
{#each navItems as item}
  <a href={item.path} class="bottom-nav-item" class:active={isActive(item.path)}
     onclick={() => { try { navigator.vibrate(5); } catch {} }}>
    <svg class="nav-icon-mobile">...</svg>
    <span class="nav-label">{item.label}</span>
  </a>
{/each}
```

---

### H-7 — `predict/+page.svelte` line 208: Save error silently logged to console, no user feedback

**File:** `src/routes/pool/[id]/predict/+page.svelte:208`  
**Category:** UI-UX

```js
} catch (e) { console.error(e); }
```

Network errors during auto-save are swallowed. The user sees no indication their prediction wasn't saved. Given predictions have a deadline, losing silent save failures can be consequential.

**Fix:** Surface errors using the existing `showToast` pattern used in `bracket/+page.svelte`:
```js
} catch (e) {
  console.error(e);
  showToast('⚠️ Error al guardar — inténtalo de nuevo');
}
```

---

## MEDIUM

---

### M-1 — `bracket/+page.svelte` lines 127-205: Version counter anti-pattern causes full deep-clone on every pick

**File:** `src/routes/pool/[id]/bracket/+page.svelte:127-205`  
**Category:** REACTIVITY / PERFORMANCE

The bracket state is stored in plain (non-reactive) objects `_teams` and `_picks`, mutated directly, then a `version` counter is bumped to notify the UI:

```js
let version = $state(0);
let _teams = {};   // NOT $state
let _picks = {};   // NOT $state
function bump() { version++; }

const teams = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_teams)); });
const explicitPicks = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_picks)); });
```

**Issues:**
1. `JSON.parse(JSON.stringify())` deep-clones the entire bracket state on every single pick (16+8+4+2+1+1 = 32 matches). This is called twice per pick (`teams` and `explicitPicks`).
2. The `void version` dependency trick is a Svelte 4-era workaround not needed with Svelte 5 runes.
3. If `data` changes (soft navigation), `initState()` won't re-run because `initialized` is a plain `let` flag (not reactive), so the bracket state becomes permanently stale.

**Fix:** Convert `_teams` and `_picks` to `$state` and mutate via reassignment:
```js
let teams = $state({ r32: [], r16: [], qf: [], sf: [], final: [], '3rd': [] });
let explicitPicks = $state({ r32: [], r16: [], qf: [], sf: [], final: [], '3rd': [] });
// Replace bump() calls with direct reassignment:
teams.r32 = [...teams.r32]; // triggers reactivity
```

---

### M-2 — `admin/+page.svelte` lines 44, 59: `creators.push()` and `creators.splice()` — mutation pattern inconsistency

**File:** `src/routes/admin/+page.svelte:44`, `src/routes/admin/+page.svelte:59`  
**Category:** REACTIVITY

```js
let creators = $state([...data.creators]);

// Line 44
creators.push(user);       // Svelte 5 $state arrays ARE proxied, so push() IS reactive

// Line 59
creators.splice(idx, 1);   // $state arrays also track splice() — reactive
```

These are actually valid in Svelte 5 (runes mode proxies array mutations). However, contrasted with other files in the codebase that use `_members = _members.map(...)` reassignment, the style is inconsistent. More importantly, `allUsers` and `_members` in other places use plain `let` + version counters, creating a maintenance inconsistency.

**Medium severity** because it works correctly but is inconsistent with the rest of the codebase's patterns.

---

### M-3 — `pool/[id]/+page.svelte` line 7: `prevTabIndex` declared as `$state` but never read

**File:** `src/routes/pool/[id]/+page.svelte:7`  
**Category:** REACTIVITY

```js
let prevTabIndex = $state(tabIndexOrder.indexOf(tab));
// ...
function switchTab(newTab: string) {
  const oldIdx = tabIndexOrder.indexOf(tab); // uses tab, not prevTabIndex
  const newIdx = tabIndexOrder.indexOf(newTab);
  prevTabIndex = newIdx; // written but never read
  slideDir = newIdx > oldIdx ? 'left' : 'right';
  tab = newTab;
}
```

`prevTabIndex` is set on every tab switch but never used in any template expression or derived value. The slide direction is correctly calculated from `oldIdx` (derived from `tab` at call time).

**Fix:** Remove `prevTabIndex` entirely.

---

### M-4 — `pool/[id]/+page.svelte` line 222: Dead `{#if t.link}` branch

**File:** `src/routes/pool/[id]/+page.svelte:222`  
**Category:** REACTIVITY

```svelte
{#each tabs as t, i}
  {#if t.link}
    <a href="/pool/{pool.id}/{t.id}" class="pool-tab" class:active={false}>{t.label}</a>
  {:else}
    <button ...>{t.label}</button>
  {/if}
{/each}
```

None of the `tabs` objects (defined lines 85-91) have a `link` property. The `{#if t.link}` branch is dead code and will never execute. The `class:active={false}` also hints this was copy-paste that was never wired up.

**Fix:** Remove the `{#if t.link}` branch.

---

### M-5 — `pool/[id]/+page.svelte` lines 457-472: `getGroupPreds()` and `getBracketPreds()` called multiple times in template

**File:** `src/routes/pool/[id]/+page.svelte:448`, `src/routes/pool/[id]/+page.svelte:471-472`  
**Category:** PERFORMANCE

Both `getGroupPreds()` and `getBracketPreds()` are plain functions that rebuild their result from scratch on each call. They're called 2-3 times each in the Summary tab:

```svelte
{#each getGroupPreds() as gp}   <!-- builds array -->
{#if getGroupPreds().length === 0}  <!-- builds again -->

{@const bracketPreds = getBracketPreds()}  <!-- builds object -->
{#if Object.keys(getBracketPreds()).length === 0}  <!-- builds again -->
```

**Fix:** Convert to `$derived`:
```js
const groupPreds = $derived.by(() => {
  if (!summaryEntry) return [];
  return data.groupPreds[summaryEntry] || [];
});
const bracketPredsByPhase = $derived.by(() => {
  if (!summaryEntry) return {};
  const raw = data.bracketPreds[summaryEntry] || [];
  const grouped = {};
  for (const b of raw) {
    if (!grouped[b.phase]) grouped[b.phase] = [];
    grouped[b.phase].push(b);
  }
  return grouped;
});
```

---

### M-6 — `leaderboard/+page.svelte` lines 17-58: Column template mismatch between skeleton, header, and rows

**File:** `src/routes/leaderboard/+page.svelte:17-58`  
**Category:** UI-UX / DESIGN

Three different `grid-template-columns` values are used for what should be the same table:

| Element | Template | Columns |
|---------|----------|---------|
| Skeleton header (line 17) | `40px 1fr 50px 40px 40px` | 5 |
| Skeleton rows (line 21) | `40px 1fr 70px 60px` | 4 |
| Real header (line 41) | `40px 1fr 60px 60px` | 4 |
| Real rows (line 48) | `40px 1fr 50px 40px 40px` | 5 |

This causes the "Pts" and "Aciertos" columns to be misaligned — the header shows 4 columns but rows render 5. The skeleton renders 4 rows but expects 5 columns in its header.

**Fix:** Decide on a column layout (5 columns: rank avatar + name + pts + exact + total) and apply it consistently to all four templates.

---

### M-7 — `pool/[id]/+page.svelte` lines 582-603: Bottom sheet overlay missing `Escape` key handler

**File:** `src/routes/pool/[id]/+page.svelte:582-603`  
**Category:** ACCESSIBILITY

The bottom sheet has `onclick={closeSheet}` for backdrop click-to-close and touch-drag-to-dismiss, but no keyboard close handler. The admin confirm dialog in the same codebase correctly implements `onkeydown` for Escape. Inconsistent behavior.

**Fix:**
```svelte
<div class="bottom-sheet-overlay" onclick={closeSheet}
  onkeydown={(e) => { if (e.key === 'Escape') closeSheet(); }}
  role="dialog" aria-modal="true" tabindex="-1">
```

---

### M-8 — `bracket/+page.svelte` line 329-339: `loadTiebreaker()` defined but never called (dead code)

**File:** `src/routes/pool/[id]/bracket/+page.svelte:329-339`  
**Category:** REACTIVITY

```js
async function loadTiebreaker() {
  if (!data.selectedId) return;
  try {
    const r = await fetch(`/api/predictions/tiebreaker?prediction_id=${data.selectedId}`);
    if (r.ok) { ... }
  } catch {}
}
```

The tiebreaker loading is actually performed in a `$effect` at lines 365-379. The `loadTiebreaker` function is never called and duplicates the same `fetch` logic. It is dead code.

**Fix:** Delete `loadTiebreaker()`.

---

### M-9 — `app.css` line 292-296: Desktop `main-content` not centered on ultra-wide screens

**File:** `src/app.css:291-298`  
**Category:** DESIGN

```css
@media (min-width: 768px) {
  .main-content {
    margin-left: 220px;
    flex: 1;
    padding: 36px 40px;
    max-width: 1200px;
    /* missing: width: calc(100% - 220px); or auto-centering */
  }
}
```

On screens wider than ~1600px, the content is left-aligned with `margin-left: 220px` and capped at `max-width: 1200px`, leaving a large blank right margin. The content never centers relative to the available space.

**Fix:**
```css
.main-content {
  margin-left: 220px;
  flex: 1;
  padding: 36px 40px;
  max-width: 1200px;
  width: calc(100% - 220px);
}
```

---

### M-10 — `pool/[id]/admin/+page.svelte` line 38: Incorrect Spanish label for `knockout_r32`

**File:** `src/routes/pool/[id]/admin/+page.svelte:38`  
**Category:** DESIGN / UI-UX

```js
const ruleLabels = {
  knockout_r32: 'Octavos (R32)',       // wrong: R32 is "dieciseisavos"
  knockout_r16: 'Octavos de final',    // correct
```

In the 2026 World Cup format with 48 teams, the Round of 32 ("R32") is "Dieciseisavos de final" in Spanish, not "Octavos". The `predict/+page.svelte` correctly uses "Dieciseisavos" for R32. This creates a confusing inconsistency in the scoring configuration UI.

**Fix:**
```js
knockout_r32: 'Dieciseisavos (R32)',
```

---

## LOW

---

### L-1 — `join/[code]/+page.svelte` line 33: `_autoFired` non-reactive flag creates misleading `$effect` semantics

**File:** `src/routes/join/[code]/+page.svelte:33-60`  
**Category:** REACTIVITY

```js
let _autoFired = false;  // plain let, NOT $state
$effect(() => {
  if (data.code && !loading && !joined && !error && !_autoFired) {
    _autoFired = true;  // mutation won't re-trigger the effect
    // ... fetch ...
  }
});
```

The `$effect` reads `_autoFired` but since it's not `$state`, changes to `_autoFired` don't appear in the dependency graph. The effect relies on never being re-triggered after the initial run (its only other dependencies `data.code`, `loading`, `joined`, `error` shouldn't change in a way that would re-trigger it). This works by accident and is misleading.

**Fix:** Use `$effect` cleanup pattern or a simple `onMount`:
```js
import { onMount } from 'svelte';
onMount(() => {
  if (data.code) {
    // auto-join logic
  }
});
```

---

### L-2 — `login/+page.svelte` line 85: Missing `autocomplete="name"` on display name field

**File:** `src/routes/login/+page.svelte:85`  
**Category:** ACCESSIBILITY / UI-UX

```svelte
<input bind:value={displayName} placeholder="Tu nombre" required />
```

No `autocomplete` attribute. Adding `autocomplete="name"` enables browser password managers and autofill to populate the field during registration.

**Fix:** `<input bind:value={displayName} placeholder="Tu nombre" required autocomplete="name" />`

---

### L-3 — `predict/+page.svelte` line 694-707: Both desktop and mobile group cards rendered simultaneously

**File:** `src/routes/pool/[id]/predict/+page.svelte:694-707`  
**Category:** PERFORMANCE

For each of the 12 groups, two `group-card` elements are rendered (one `.desktop-view`, one `.mobile-view`), toggled by CSS `hover`/`pointer` media queries. With 4 teams each, this creates 24 card elements in the DOM holding 96 button elements, where only 12 are visible at any time.

While functional, it doubles the DOM element count and causes both layouts to be hydrated/rendered on every change to `selections`.

**Low severity** because 48 teams × 2 = 96 buttons is within acceptable limits for modern devices.

---

### L-4 — `PullToRefresh.svelte` line 38: `overflow-y: auto` on the pull container may conflict with inner scroll

**File:** `src/lib/components/PullToRefresh.svelte:38`  
**Category:** UI-UX

```svelte
<div ... style="min-height:100%;overflow-y:auto;">
```

The pull-to-refresh container sets `overflow-y: auto`, but it checks `el.scrollTop > 0` to prevent triggering pull when the user is mid-scroll. However, inner scrollable elements (e.g., the bracket horizontal scroll) could propagate touch events up to this container and interfere with the pull gesture detection.

**Low severity** — only occurs when the bracket's horizontal scroll is near the top of the page on mobile.

---

### L-5 — `app.css` line 479: `bottom-sheet-handle` uses `var(--glass-border, #333)` fallback to `#333`

**File:** `src/app.css:480`  
**Category:** DESIGN

```css
.bottom-sheet-handle { background: var(--glass-border, #333); }
```

The `#333` fallback is dark and will be invisible against a dark theme background (the handle is meant to be a subtle drag indicator). In light mode, `#333` shows as a dark grey bar, which is jarring.

**Fix:** Use a theme-appropriate fallback:
```css
.bottom-sheet-handle { background: var(--glass-border, var(--border)); }
```

---

### L-6 — `bracket/+page.svelte` line 576: Create-entry form shows when `newEntryLabel !== ''` but button sets it to `''`

**File:** `src/routes/pool/[id]/bracket/+page.svelte:551-556`, `src/routes/pool/[id]/bracket/+page.svelte:576`  
**Category:** UI-UX

The create-entry form is shown when `data.pool.allow_multiple_predictions && newEntryLabel !== ''`. The "Nueva entrada" button at line 551 sets `newEntryLabel = ''`:

```svelte
<button onclick={() => { newEntryLabel = ''; createMsg = ''; }}>
  + Nueva entrada
</button>
```

Setting `newEntryLabel = ''` means the condition `newEntryLabel !== ''` is immediately false, so the form never appears when this button is clicked. The intent was probably to show the form — unlike `predict/+page.svelte` which uses a separate `showCreateEntry = true` flag.

**Fix:** Use a separate boolean flag like `predict/+page.svelte` does:
```js
let showCreateEntry = $state(false);
// Button:
onclick={() => { showCreateEntry = true; newEntryLabel = ''; }}
// Form condition:
{#if data.pool.allow_multiple_predictions && showCreateEntry}
```

---

### L-7 — `leaderboard/+page.svelte` line 37: Unauthenticated state shows "Iniciar sesión" link but page is behind auth

**File:** `src/routes/leaderboard/+page.svelte:37`  
**Category:** UI-UX

```svelte
{:else if leaderboard.length === 0}
  ...
  <a href="/login" class="btn-primary" ...>Iniciar sesión</a>
```

The leaderboard page is behind authentication (the layout checks `data?.user`). An empty leaderboard (`length === 0`) while authenticated shows a login button, which is a logically incorrect empty state for authenticated users who simply haven't made predictions yet.

**Fix:** The empty state should encourage joining/predicting, not logging in:
```svelte
<p style="...">¡Sé el primero! Únete a una quiniela y predice.</p>
<a href="/pools" class="btn-primary" ...>Ver quinielas</a>
```

---

### L-8 — `+layout.svelte`: Google Fonts (`Inter`, `Libre Baskerville`) not imported in layout or `app.html`

**File:** `src/routes/+layout.svelte`, `src/app.css`  
**Category:** DESIGN / PERFORMANCE

`app.css` uses `font-family: 'Inter'` and `'Libre Baskerville', serif` throughout, but neither font is imported via `@import` in `app.css` or via `<link>` in the layout's `<svelte:head>`. Without loading these fonts, browsers fall back to system fonts, changing the visual appearance from the design intent.

If fonts are loaded in `src/app.html` (not read during this audit), this finding is moot. Otherwise:

**Fix (in `src/app.css` before existing styles):**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&display=swap');
```

Or self-host for performance and offline PWA support.

---

## Cross-cutting Observations

### Style architecture: 90% inline styles
Almost every element in every `.svelte` file uses inline `style="..."` attributes rather than CSS classes. While this avoids naming collisions, it makes global theming changes (e.g., updating border-radius, spacing rhythm, or adding dark mode overrides) require touching every file. The app already has a partial class system (`pool-card`, `stat-card`, `badge`, etc.) — extending it would pay dividends in maintainability.

### No global error boundary
No error page (`+error.svelte`) is defined at any route level. SvelteKit will use its default error UI, which doesn't match the app's design.

### Accessibility baseline
- Most interactive elements lack `aria-label` attributes (icon-only buttons, nav items)
- Focus rings: `outline: none` is set on inputs (line 123 of `app.css`) globally with no `:focus-visible` fallback
- The tab system in `pool/[id]/+page.svelte` uses `<button>` elements but lacks `role="tab"`, `role="tabpanel"`, and `aria-selected`

**Fix for inputs:**
```css
input:focus, select:focus, textarea:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px rgba(201,168,76,0.1);
  /* Remove: outline: none; */
  outline: 2px solid transparent; /* Keeps layout, removes system ring which is replaced by box-shadow */
}
```

---

*End of Audit #3*
