# Fix Plan — Audit #3 Frontend
**Generated:** 2026-05-27  
**Source audit:** AUDIT-3-FRONTEND.md  
**Findings:** 29 (C-1…C-4, H-1…H-7, M-1…M-10, L-1…L-8)

---

## Pre-flight notes

| Finding | Status |
|---------|--------|
| **H-1** | **MOOT** — `src/app.html` line 17 already has the blocking theme-init `<script>`. No action needed. |
| **L-8** | **MOOT** — `src/app.html` line 16 already loads Inter + Libre Baskerville via `<link>`. No action needed. |
| **M-2** | **DEFERRED** — `$state` array mutations (`push`, `splice`) in `src/routes/admin/+page.svelte` are valid in Svelte 5 runes mode. Finding is a style inconsistency, not a bug. No fix required for functionality. |

Remaining fixes: **26 across 12 files**.

---

## Dependency Order

Apply fixes in this order to avoid conflicts within the same file:

1. `src/app.css` — C-1 first (defines variables used everywhere), then H-6-css, then M-9, then L-5
2. `src/routes/+layout.svelte` — H-2 first (changes `currentPath` from `$state` to `$derived`, which H-3 and C-4 both depend on for context), then H-3, then C-4, then H-6
3. `src/routes/pool/[id]/bracket/+page.svelte` — L-6 first (adds `showCreateEntry` state var near `newEntryLabel`), then M-8, then C-2
4. `src/routes/pool/[id]/+page.svelte` — M-3 first, then M-4, then M-5 (replaces functions used at template lines touched by M-4), then M-7
5. `src/routes/leaderboard/+page.svelte` — M-6 first (structural), then L-7

All other files are independent.

---

## CRITICAL Fixes

---

### C-1 · `src/app.css`

**Problem:** `--bg2` and `--bg3` are used in `.skeleton` and `.bottom-sheet` but never defined. All skeletons render transparent; bottom sheet is invisible.

**File:** `src/app.css`  
**Lines:** 49–85 (`:root` and `:root[data-theme="light"]` blocks)

#### Old code
```css
:root {
  --bg: #07090f;
  --bg-base: #07090f;
  --bg-surface: rgba(255,255,255,0.03);
  --bg-card: rgba(13, 17, 32, 0.6);
  --bg-card-solid: #0d1120;
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  --text: #d4dce8;
  --text-muted: #99aabb;
  --text-dim: #7a8a9a;
  --gold: #c9a84c;
  --gold-light: #e8c96a;
  --green: #00e5a0;
  --red: #ff4d6a;
  --blue: #5b9cf5;
  --bg-nav: rgba(15, 19, 35, 0.95);
}

:root[data-theme="light"] {
  --bg: #f5f5f0;
  --bg-base: #f5f5f0;
  --bg-surface: rgba(0,0,0,0.03);
  --bg-card: rgba(255, 255, 255, 0.8);
  --bg-card-solid: #ffffff;
  --border: rgba(0, 0, 0, 0.1);
  --border-hover: rgba(0, 0, 0, 0.18);
  --text: #1a1a2e;
  --text-muted: #6b7280;
  --text-dim: #9ca3af;
  --gold: #a07c1c;
  --gold-light: #c9a84c;
  --green: #059669;
  --red: #dc2626;
  --blue: #2563eb;
  --bg-nav: rgba(230, 230, 225, 0.95);
}
```

#### New code
```css
:root {
  --bg: #07090f;
  --bg-base: #07090f;
  --bg-surface: rgba(255,255,255,0.03);
  --bg-card: rgba(13, 17, 32, 0.6);
  --bg-card-solid: #0d1120;
  --bg2: #0d1120;
  --bg3: #1a1d26;
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  --text: #d4dce8;
  --text-muted: #99aabb;
  --text-dim: #7a8a9a;
  --gold: #c9a84c;
  --gold-light: #e8c96a;
  --green: #00e5a0;
  --red: #ff4d6a;
  --blue: #5b9cf5;
  --bg-nav: rgba(15, 19, 35, 0.95);
}

:root[data-theme="light"] {
  --bg: #f5f5f0;
  --bg-base: #f5f5f0;
  --bg-surface: rgba(0,0,0,0.03);
  --bg-card: rgba(255, 255, 255, 0.8);
  --bg-card-solid: #ffffff;
  --bg2: #e8e8e4;
  --bg3: #f0f0ec;
  --border: rgba(0, 0, 0, 0.1);
  --border-hover: rgba(0, 0, 0, 0.18);
  --text: #1a1a2e;
  --text-muted: #6b7280;
  --text-dim: #9ca3af;
  --gold: #a07c1c;
  --gold-light: #c9a84c;
  --green: #059669;
  --red: #dc2626;
  --blue: #2563eb;
  --bg-nav: rgba(230, 230, 225, 0.95);
}
```

---

### C-2 · `src/routes/pool/[id]/bracket/+page.svelte`

**Problem:** `.third-team-btn` uses `var(--bg-primary)` and `var(--text-primary)` — neither exists in the design system. Third-place team selector buttons render with transparent backgrounds.

**File:** `src/routes/pool/[id]/bracket/+page.svelte`  
**Lines:** ~1581–1587 (inside `<style>` block)

#### Old code
```css
  .third-team-btn {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-primary); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; cursor: pointer;
    transition: all 0.15s; text-align: left;
    color: var(--text-primary);
  }
```

#### New code
```css
  .third-team-btn {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; cursor: pointer;
    transition: all 0.15s; text-align: left;
    color: var(--text);
  }
```

---

### C-3 · `src/routes/pool/[id]/results/+page.svelte`

**Problem:** The entry `<select>` is bound to `selectedEntry` but all prediction lookups are plain `const` objects built once from initial data. Changing the dropdown has no effect.

**File:** `src/routes/pool/[id]/results/+page.svelte`

**Step 1 — Add `goto` import (line 2, after existing `import { page }`):**

#### Old code (lines 1–2)
```js
<script lang="ts">
  import { page } from '$app/stores';
```

#### New code
```js
<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
```

**Step 2 — Replace the `bind:value` select with a navigation-triggering `onchange` (line ~101):**

#### Old code
```svelte
      <select bind:value={selectedEntry} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
```

#### New code
```svelte
      <select value={selectedEntry} onchange={(e) => goto(`?entry=${(e.target as HTMLSelectElement).value}`, { invalidateAll: true })} style="font-size: 11px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text);">
```

---

### C-4 · `src/routes/+layout.svelte`

**Problem:** `typeof window !== 'undefined'` inside a Svelte template block causes a hydration mismatch — SSR renders nothing, client renders "En juego" badge.

**File:** `src/routes/+layout.svelte`  
**Line:** ~120

#### Old code
```svelte
          {:else if typeof window !== 'undefined'}
```

#### New code
```svelte
          {:else if browser}
```

*Note: `browser` is already imported from `'$app/environment'` at line 2 of the same file. No new import needed.*

---

## HIGH Fixes

---

### H-2 · `src/routes/+layout.svelte`

**Problem:** `currentPath` uses `$state + $effect`, causing a one-tick stale value on navigation (nav items flicker active state).

**File:** `src/routes/+layout.svelte`  
**Lines:** 18–21

#### Old code
```js
  let currentPath = $state('');
  $effect(() => {
    currentPath = $page.url.pathname;
  });
```

#### New code
```js
  const currentPath = $derived($page.url.pathname);
```

*Dependencies: Apply before H-3 since H-3 restructures the `onMount` block that follows.*

---

### H-3 · `src/routes/+layout.svelte`

**Problem:** `page.subscribe()` inside `onMount` mixes legacy subscription with rune-style `$page` auto-subscription. Two subscriptions to the same store with different cleanup patterns.

**File:** `src/routes/+layout.svelte`  
**Lines:** 68–96

#### Old code
```js
  // Staggered card entrance + animated counters
  onMount(() => {
    if (!browser) return;
    const stagger = () => {
      let i = 0;
      document.querySelectorAll('.pool-card:not(.stagger-in), .stat-card:not(.stagger-in)').forEach(el => {
        el.style.animationDelay = `${i * 60}ms`;
        el.classList.add('stagger-in');
        i++;
      });
      document.querySelectorAll('.stat-value[data-count]:not(.count-animate)').forEach(el => {
        const target = parseInt(el.dataset.count);
        if (isNaN(target)) return;
        el.classList.add('count-animate');
        const duration = 600;
        const start = performance.now();
        const tick = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(target * eased);
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    };
    stagger();
    // Re-run stagger on page navigation (not on every DOM mutation)
    const unsubscribe = page.subscribe(() => setTimeout(stagger, 100));
    return unsubscribe;
  });
```

#### New code
```js
  // Staggered card entrance + animated counters
  function stagger() {
    let i = 0;
    document.querySelectorAll('.pool-card:not(.stagger-in), .stat-card:not(.stagger-in)').forEach(el => {
      el.style.animationDelay = `${i * 60}ms`;
      el.classList.add('stagger-in');
      i++;
    });
    document.querySelectorAll('.stat-value[data-count]:not(.count-animate)').forEach(el => {
      const target = parseInt(el.dataset.count);
      if (isNaN(target)) return;
      el.classList.add('count-animate');
      const duration = 600;
      const start = performance.now();
      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  onMount(() => {
    if (!browser) return;
    stagger();
  });

  $effect(() => {
    $page; // reactive dependency — re-run stagger after each navigation
    setTimeout(stagger, 100);
  });
```

*Note: `stagger` checks `.stagger-in` / `.count-animate` classes before animating, so the double-call on first mount is idempotent — `onMount` runs first, then `$effect` fires ~100 ms later and finds no undecorated elements.*

---

### H-4 · `src/routes/profile/+page.svelte`

**Problem:** `isDark` is initialized at module-parse time with a DOM read (`document.documentElement...`). During SSR this evaluates to `false` (no `window`). After hydration, the layout's own `$effect` updates its `isDark`, but the profile's copy stays stale — toggling theme from the profile page shows the wrong icon in the top bar.

**File:** `src/routes/profile/+page.svelte`  
**Line:** 11

#### Old code
```js
  let isDark = $state(typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light');
```

#### New code
```js
  let isDark = $state(false);
  $effect(() => {
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  });
```

---

### H-5 · `src/routes/pool/[id]/admin/+page.svelte`

**Problem:** Save button reads input values via `document.querySelector` — if the DOM element is null (race, re-render) the save silently fails with no user feedback.

**File:** `src/routes/pool/[id]/admin/+page.svelte`  
**Lines:** ~428–463 (match score inputs and save button onclick)

#### Old code
```svelte
            <input
              type="number"
              min="0"
              value={match.home_score ?? ''}
              placeholder="-"
              data-match-id={match.id}
              data-side="home"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="color: var(--text-dim);">-</span>
            <input
              type="number"
              min="0"
              value={match.away_score ?? ''}
              placeholder="-"
              data-match-id={match.id}
              data-side="away"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="flex: 1; text-align: right; {isFinished ? '' : 'color: var(--text-muted);'}">{match.away_name ?? 'TBD'}</span>
            <button type="submit" class="btn-primary"
      style="font-size: 8px; padding: 4px 8px;"
      onclick={async () => {
        const row = document.querySelector(`[data-match-id="${match.id}"][data-side="home"]`);
        const row2 = document.querySelector(`[data-match-id="${match.id}"][data-side="away"]`);
        const hs = Number(row?.value);
        const as2 = Number(row2?.value);
        if (isNaN(hs) || isNaN(as2)) return;
        const res = await fetch('/api/admin/results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pool_id: pool.id, match_id: match.id, home_score: hs, away_score: as2 }),
        });
        if (res.ok) { match.status = 'finished'; match.home_score = hs; match.away_score = as2; }
      }}
    >Guardar</button>
```

#### New code
```svelte
            <input
              type="number"
              min="0"
              bind:value={match.home_score}
              placeholder="-"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="color: var(--text-dim);">-</span>
            <input
              type="number"
              min="0"
              bind:value={match.away_score}
              placeholder="-"
              style="width: 40px; text-align: center; padding: 4px;"
            />
            <span style="flex: 1; text-align: right; {isFinished ? '' : 'color: var(--text-muted);'}">{match.away_name ?? 'TBD'}</span>
            <button type="submit" class="btn-primary"
      style="font-size: 8px; padding: 4px 8px;"
      onclick={async () => {
        const hs = Number(match.home_score);
        const as2 = Number(match.away_score);
        if (!Number.isFinite(hs) || !Number.isFinite(as2) || hs < 0 || as2 < 0) return;
        const res = await fetch('/api/admin/results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pool_id: pool.id, match_id: match.id, home_score: hs, away_score: as2 }),
        });
        if (res.ok) { match.status = 'finished'; match.home_score = hs; match.away_score = as2; }
      }}
    >Guardar</button>
```

---

### H-6 · `src/app.css` + `src/routes/+layout.svelte`

**Problem:** `<a href>` wrapping `<button>` is invalid HTML. Causes duplicate Tab stops, confuses screen readers, and fires vibration separately from navigation.

**This fix requires changes in TWO files.**

#### Part A — `src/app.css`: Restyle nav items from `button` to `a`

**Lines:** ~192–221

##### Old code
```css
.bottom-nav button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 8px;
  letter-spacing: 0.06em;
  min-width: 44px;
  min-height: 40px;
  padding: 3px 8px;
}

.bottom-nav button.active {
  color: var(--gold);
  position: relative;
}
.bottom-nav button.active::after {
  content: '';
  position: absolute;
  top: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: var(--gold);
  border-radius: 1px;
}
```

##### New code
```css
.bottom-nav a {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 8px;
  letter-spacing: 0.06em;
  min-width: 44px;
  min-height: 40px;
  padding: 3px 8px;
  text-decoration: none;
}

.bottom-nav a.active {
  color: var(--gold);
  position: relative;
}
.bottom-nav a.active::after {
  content: '';
  position: absolute;
  top: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: var(--gold);
  border-radius: 1px;
}
```

#### Part B — `src/routes/+layout.svelte`: Replace `<a><button>` with single `<a>`

**Lines:** ~204–211

##### Old code
```svelte
<div class="bottom-nav">
  {#each navItems as item}
    <a href={item.path}>
      <button class:active={isActive(item.path)} onclick={() => { try { navigator.vibrate(5); } catch {} }}>
        <svg class="nav-icon-mobile"><use href="/icon.svg#{item.icon}" /></svg>
        <span class="nav-label">{item.label}</span>
      </button>
    </a>
  {/each}
</div>
```

##### New code
```svelte
<div class="bottom-nav">
  {#each navItems as item}
    <a href={item.path} class:active={isActive(item.path)}
       onclick={() => { try { navigator.vibrate(5); } catch {} }}>
      <svg class="nav-icon-mobile"><use href="/icon.svg#{item.icon}" /></svg>
      <span class="nav-label">{item.label}</span>
    </a>
  {/each}
</div>
```

---

### H-7 · `src/routes/pool/[id]/predict/+page.svelte`

**Problem:** Auto-save errors are silently swallowed with `console.error`. Users receive no feedback when predictions fail to save.

**File:** `src/routes/pool/[id]/predict/+page.svelte`

**Step 1 — Add `showToast` import (line 2, `$lib/toast` already exists):**

#### Old code (lines 1–3)
```js
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
```

#### New code
```js
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { showToast } from '$lib/toast';
```

**Step 2 — Surface the error to the user (~line 208):**

#### Old code
```js
    } catch (e) { console.error(e); }
    finally { saving = false; }
```

#### New code
```js
    } catch (e) {
      console.error(e);
      showToast('⚠️ Error al guardar — inténtalo de nuevo');
    }
    finally { saving = false; }
```

---

## MEDIUM Fixes

---

### M-1 · `src/routes/pool/[id]/bracket/+page.svelte`

**Problem:** Version-counter pattern deep-clones the entire bracket on every pick via `JSON.parse(JSON.stringify(...))`. Called twice per pick.

**Note:** This is a significant refactor touching ~100 lines. It is lower-risk to defer to a dedicated branch. A minimal safe improvement that avoids the full refactor:

**Minimal fix** — Replace the two `$derived.by` clones with shallow copies (drops the `JSON.parse/stringify` cost while keeping the version pattern as-is):

Locate the two derived declarations (after `function bump() { version++; }`):

#### Old code
```js
  const teams = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_teams)); });
  const explicitPicks = $derived.by(() => { void version; return JSON.parse(JSON.stringify(_picks)); });
```

#### New code
```js
  const teams = $derived.by(() => {
    void version;
    const t = {};
    for (const [k, v] of Object.entries(_teams)) t[k] = Array.isArray(v) ? [...v] : v;
    return t;
  });
  const explicitPicks = $derived.by(() => {
    void version;
    const p = {};
    for (const [k, v] of Object.entries(_picks)) p[k] = Array.isArray(v) ? v.map(row => [...row]) : v;
    return p;
  });
```

*This removes the O(n log n) JSON serialization cost. A full Svelte 5 `$state` refactor should be tracked as a separate task.*

---

### M-3 · `src/routes/pool/[id]/+page.svelte`

**Problem:** `prevTabIndex` is declared as `$state` but never read — written on every tab switch and ignored.

**File:** `src/routes/pool/[id]/+page.svelte`

**Step 1 — Remove the declaration (line 7):**

#### Old code
```js
  let prevTabIndex = $state(tabIndexOrder.indexOf(tab));
```

#### New code
*(delete this line entirely)*

**Step 2 — Remove the write inside `switchTab` (line 13):**

#### Old code
```js
  function switchTab(newTab: string) {
    haptic(8);
    const oldIdx = tabIndexOrder.indexOf(tab);
    const newIdx = tabIndexOrder.indexOf(newTab);
    prevTabIndex = newIdx;
    slideDir = newIdx > oldIdx ? 'left' : 'right';
    tab = newTab;
  }
```

#### New code
```js
  function switchTab(newTab: string) {
    haptic(8);
    const oldIdx = tabIndexOrder.indexOf(tab);
    const newIdx = tabIndexOrder.indexOf(newTab);
    slideDir = newIdx > oldIdx ? 'left' : 'right';
    tab = newTab;
  }
```

---

### M-4 · `src/routes/pool/[id]/+page.svelte`

**Problem:** `{#if t.link}` branch in the tab renderer is dead code — no `tabs` entry has a `link` property. The `class:active={false}` confirms it was never wired up.

**File:** `src/routes/pool/[id]/+page.svelte`  
**Lines:** ~220–231

#### Old code
```svelte
  <div class="pool-tabs">
    {#each tabs as t, i}
      {#if t.link}
        <a href="/pool/{pool.id}/{t.id}" class="pool-tab" class:active={false}>{t.label}</a>
      {:else}
        <button
          onclick={() => switchTab(t.id)}
          class="pool-tab"
          class:active={tab === t.id}
        >{t.label}</button>
      {/if}
    {/each}
  </div>
```

#### New code
```svelte
  <div class="pool-tabs">
    {#each tabs as t}
      <button
        onclick={() => switchTab(t.id)}
        class="pool-tab"
        class:active={tab === t.id}
      >{t.label}</button>
    {/each}
  </div>
```

---

### M-5 · `src/routes/pool/[id]/+page.svelte`

**Problem:** `getGroupPreds()` and `getBracketPreds()` are called 2–3 times each in the Summary tab template, rebuilding results from scratch each call.

**File:** `src/routes/pool/[id]/+page.svelte`

**Step 1 — Replace the two functions with `$derived` (~lines 38–51):**

#### Old code
```js
  function getGroupPreds() {
    if (!summaryEntry) return [];
    return data.groupPreds[summaryEntry] || [];
  }
  function getBracketPreds() {
    if (!summaryEntry) return {};
    const raw = data.bracketPreds[summaryEntry] || [];
    const grouped: Record<string, any[]> = {};
    for (const b of raw) {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    }
    return grouped;
  }
```

#### New code
```js
  const groupPreds = $derived.by(() => {
    if (!summaryEntry) return [];
    return data.groupPreds[summaryEntry] || [];
  });
  const bracketPredsByPhase = $derived.by(() => {
    if (!summaryEntry) return {};
    const raw = data.bracketPreds[summaryEntry] || [];
    const grouped: Record<string, any[]> = {};
    for (const b of raw) {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    }
    return grouped;
  });
```

**Step 2 — Update template call sites (4 occurrences in the Summary tab):**

#### Old code (call site 1, ~line 430)
```svelte
          {#each getGroupPreds() as gp}
```
#### New code
```svelte
          {#each groupPreds as gp}
```

#### Old code (call site 2, ~line 448)
```svelte
          {#if getGroupPreds().length === 0}
```
#### New code
```svelte
          {#if groupPreds.length === 0}
```

#### Old code (call site 3, ~line 457)
```svelte
            {@const bracketPreds = getBracketPreds()}
```
#### New code
```svelte
            {@const bracketPreds = bracketPredsByPhase}
```

#### Old code (call site 4, ~line 472)
```svelte
          {#if Object.keys(getBracketPreds()).length === 0}
```
#### New code
```svelte
          {#if Object.keys(bracketPredsByPhase).length === 0}
```

---

### M-6 · `src/routes/leaderboard/+page.svelte`

**Problem:** Four different `grid-template-columns` values used across skeleton header, skeleton rows, real header, and real rows — columns misalign.

**Canonical layout chosen:** `40px 1fr 50px 40px 40px` (rank · name · pts · exact-hits · total-correct)

**File:** `src/routes/leaderboard/+page.svelte`

#### Fix 1 — Skeleton rows (line ~21): change from 4-column to 5-column

##### Old code
```svelte
        <div style="display: grid; grid-template-columns: 40px 1fr 70px 60px; padding: 12px 16px; border-bottom: 1px solid var(--border); align-items: center;">
          <div class="skeleton skeleton-circle"></div>
          <div>
            <div class="skeleton skeleton-text medium" style="width: 120px;"></div>
            <div class="skeleton skeleton-text short" style="margin-top: 6px; width: 80px;"></div>
          </div>
          <div class="skeleton" style="height: 20px; width: 32px; margin-left: auto;"></div>
          <div class="skeleton" style="height: 20px; width: 24px; margin-left: auto;"></div>
        </div>
```

##### New code
```svelte
        <div style="display: grid; grid-template-columns: 40px 1fr 50px 40px 40px; padding: 12px 16px; border-bottom: 1px solid var(--border); align-items: center;">
          <div class="skeleton skeleton-circle"></div>
          <div>
            <div class="skeleton skeleton-text medium" style="width: 120px;"></div>
            <div class="skeleton skeleton-text short" style="margin-top: 6px; width: 80px;"></div>
          </div>
          <div class="skeleton" style="height: 20px; width: 32px; margin-left: auto;"></div>
          <div class="skeleton" style="height: 20px; width: 24px; margin-left: auto;"></div>
          <div class="skeleton" style="height: 20px; width: 24px; margin-left: auto;"></div>
        </div>
```

#### Fix 2 — Real header (line ~41): change from 4-column to 5-column and add "Exactos" header

##### Old code
```svelte
      <div style="display: grid; grid-template-columns: 40px 1fr 60px 60px; padding: 10px 16px; font-size: 8px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--border);">
        <div>#</div>
        <div>Usuario</div>
        <div style="text-align: right;">Pts</div>
        <div style="text-align: right;">Aciertos</div>
      </div>
```

##### New code
```svelte
      <div style="display: grid; grid-template-columns: 40px 1fr 50px 40px 40px; padding: 10px 16px; font-size: 8px; color: var(--text-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--border);">
        <div>#</div>
        <div>Usuario</div>
        <div style="text-align: right;">Pts</div>
        <div style="text-align: right;">Exactos</div>
        <div style="text-align: right;">Ac.</div>
      </div>
```

---

### M-7 · `src/routes/pool/[id]/+page.svelte`

**Problem:** Bottom sheet overlay has no keyboard close handler — inconsistent with the admin confirm dialog in the same codebase.

**File:** `src/routes/pool/[id]/+page.svelte`  
**Line:** ~583

#### Old code
```svelte
  <div class="bottom-sheet-overlay" onclick={closeSheet} ontouchstart={onSheetTouchStart} ontouchmove={onSheetTouchMove} ontouchend={onSheetTouchEnd}>
```

#### New code
```svelte
  <div class="bottom-sheet-overlay" onclick={closeSheet} ontouchstart={onSheetTouchStart} ontouchmove={onSheetTouchMove} ontouchend={onSheetTouchEnd}
    onkeydown={(e) => { if (e.key === 'Escape') closeSheet(); }}
    role="dialog" aria-modal="true" tabindex="-1">
```

---

### M-8 · `src/routes/pool/[id]/bracket/+page.svelte`

**Problem:** `loadTiebreaker()` function is defined but never called — dead code duplicating the `$effect` at lines 365–379.

**File:** `src/routes/pool/[id]/bracket/+page.svelte`  
**Lines:** ~329–339

#### Old code
```js
  async function loadTiebreaker() {
    if (!data.selectedId) return;
    try {
      const r = await fetch(`/api/predictions/tiebreaker?prediction_id=${data.selectedId}`);
      if (r.ok) {
        const d = await r.json();
        tieHome = d.home_score;
        tieAway = d.away_score;
      }
    } catch {}
  }
```

#### New code
*(delete this function entirely — 10 lines)*

---

### M-9 · `src/app.css`

**Problem:** `.main-content` on desktop has no explicit width, so on screens wider than ~1600 px it is left-aligned with a large blank right margin.

**File:** `src/app.css`  
**Lines:** ~291–297 (inside `@media (min-width: 768px)`)

#### Old code
```css
  .main-content {
    margin-left: 220px;
    flex: 1;
    padding: 36px 40px;
    max-width: 1200px;
  }
```

#### New code
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

### M-10 · `src/routes/pool/[id]/admin/+page.svelte`

**Problem:** `knockout_r32` is labelled "Octavos (R32)" but R32 is the Round of 32 (dieciseisavos), not the Round of 16 (octavos). `predict/+page.svelte` already uses the correct Spanish term.

**File:** `src/routes/pool/[id]/admin/+page.svelte`  
**Line:** ~37

#### Old code
```js
    knockout_r32: 'Octavos (R32)',
```

#### New code
```js
    knockout_r32: 'Dieciseisavos (R32)',
```

---

## LOW Fixes

---

### L-1 · `src/routes/join/[code]/+page.svelte`

**Problem:** `_autoFired` is a plain `let` variable mutated inside a `$effect`. While it works by accident today (other dependencies don't re-trigger), it is semantically misleading.

**File:** `src/routes/join/[code]/+page.svelte`  
**Lines:** 2, 33–60

**Step 1 — Add `onMount` import:**

#### Old code (line 1)
```js
<script>
  let { data } = $props();
```

#### New code
```js
<script>
  import { onMount } from 'svelte';
  let { data } = $props();
```

**Step 2 — Replace `_autoFired + $effect` block (lines 32–60):**

#### Old code
```js
  // Auto-join on load — bandera de un solo disparo para evitar doble envío en hidratación SSR
  let _autoFired = false;
  $effect(() => {
    if (data.code && !loading && !joined && !error && !_autoFired) {
      _autoFired = true;
      error = '';
      loading = true;
      fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      })
        .then(async (res) => {
          const result = await res.json();
          if (!res.ok) {
            error = result.error || 'Error';
          } else {
            joined = true;
            window.location.href = `/pool/${result.pool_id}`;
          }
        })
        .catch(() => {
          error = 'Error de conexión';
        })
        .finally(() => {
          loading = false;
        });
    }
  });
```

#### New code
```js
  // Auto-join on load — runs once after hydration, avoiding SSR double-submit
  onMount(() => {
    if (!data.code) return;
    error = '';
    loading = true;
    fetch('/api/pools/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code }),
    })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) {
          error = result.error || 'Error';
        } else {
          joined = true;
          window.location.href = `/pool/${result.pool_id}`;
        }
      })
      .catch(() => {
        error = 'Error de conexión';
      })
      .finally(() => {
        loading = false;
      });
  });
```

---

### L-2 · `src/routes/login/+page.svelte`

**Problem:** Display name field in the register form has no `autocomplete` attribute, preventing password manager / browser autofill from populating it.

**File:** `src/routes/login/+page.svelte`  
**Line:** 85

#### Old code
```svelte
          <input bind:value={displayName} placeholder="Tu nombre" required />
```

#### New code
```svelte
          <input bind:value={displayName} placeholder="Tu nombre" required autocomplete="name" />
```

---

### L-3 · `src/routes/pool/[id]/predict/+page.svelte`

**Problem:** Desktop and mobile group cards are both rendered in the DOM simultaneously, doubling element count.

**Severity:** Low — 96 buttons is within acceptable bounds for modern devices. This is a CSS-only show/hide toggle. No fix needed unless performance profiling reveals it as a bottleneck. **Defer.**

---

### L-4 · `src/lib/components/PullToRefresh.svelte`

**Problem:** `overflow-y: auto` on the pull container may interfere with inner horizontal scroll areas (e.g., bracket) on mobile.

**Severity:** Low — only manifests when the bracket horizontal scroll is at page top. The existing `el.scrollTop > 0` guard mitigates most cases. **Defer** unless users report false-trigger pull-to-refresh on the bracket page.

---

### L-5 · `src/app.css`

**Problem:** `.bottom-sheet-handle` uses `var(--glass-border, #333)` — the `#333` fallback is dark in dark mode (invisible) and jarring in light mode.

**File:** `src/app.css`  
**Line:** 480

#### Old code
```css
.bottom-sheet-handle { width: 36px; height: 6px; background: var(--glass-border, #333); border-radius: 3px; margin: 0 auto 16px; }
```

#### New code
```css
.bottom-sheet-handle { width: 36px; height: 6px; background: var(--glass-border, var(--border)); border-radius: 3px; margin: 0 auto 16px; }
```

---

### L-6 · `src/routes/pool/[id]/bracket/+page.svelte`

**Problem:** The "Nueva entrada" button sets `newEntryLabel = ''`, which immediately makes the condition `newEntryLabel !== ''` false — the create form never appears.

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

**Step 1 — Add `showCreateEntry` state near `newEntryLabel` (~line 393):**

#### Old code
```js
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');
```

#### New code
```js
  let showCreateEntry = $state(false);
  let newEntryLabel = $state('');
  let creating = $state(false);
  let createMsg = $state('');
```

**Step 2 — Fix the "Nueva entrada" button onclick (~line 551):**

#### Old code
```svelte
          <button onclick={() => { newEntryLabel = ''; createMsg = ''; }}
            style="font-size: 9px; padding: 6px 10px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;">
            + Nueva entrada
          </button>
```

#### New code
```svelte
          <button onclick={() => { showCreateEntry = true; newEntryLabel = ''; createMsg = ''; }}
            style="font-size: 9px; padding: 6px 10px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(201,168,76,0.1); color: var(--gold); cursor: pointer;">
            + Nueva entrada
          </button>
```

**Step 3 — Fix the create-form condition (~line 576):**

#### Old code
```svelte
  {#if data.pool.allow_multiple_predictions && newEntryLabel !== ''}
```

#### New code
```svelte
  {#if data.pool.allow_multiple_predictions && showCreateEntry}
```

**Step 4 — Reset `showCreateEntry` on cancel (~line 584) and on successful creation (~line 484):**

The cancel button (line ~584):

##### Old code
```svelte
      <button onclick={() => { newEntryLabel = ''; createMsg = ''; }} style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
```

##### New code
```svelte
      <button onclick={() => { showCreateEntry = false; newEntryLabel = ''; createMsg = ''; }} style="font-size: 9px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer;">✕</button>
```

The `createEntry()` function success path (~line 484):

##### Old code
```js
      if (res.ok) {
        newEntryLabel = '';
        window.location.href = `/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`;
```

##### New code
```js
      if (res.ok) {
        showCreateEntry = false;
        newEntryLabel = '';
        window.location.href = `/pool/${data.pool.id}/bracket?entry=${encodeURIComponent(d.label)}`;
```

---

### L-7 · `src/routes/leaderboard/+page.svelte`

**Problem:** When the leaderboard is empty, an authenticated user sees a "Iniciar sesión" button — logically wrong for someone already logged in.

**File:** `src/routes/leaderboard/+page.svelte`  
**Lines:** ~32–38

#### Old code
```svelte
  {:else if leaderboard.length === 0}
    <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
      <div style="font-size: 40px; margin-bottom: 12px;">🏆</div>
      <p style="font-size: 13px;">Aún no hay predicciones registradas.</p>
      <p style="font-size: 11px; margin-top: 8px;">¡Únete a una quiniela y empieza a ganar!</p>
      <a href="/login" class="btn-primary" style="display: inline-block; margin-top: 20px; font-size: 11px; padding: 10px 24px;">Iniciar sesión</a>
    </div>
```

#### New code
```svelte
  {:else if leaderboard.length === 0}
    <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
      <div style="font-size: 40px; margin-bottom: 12px;">🏆</div>
      <p style="font-size: 13px;">Aún no hay predicciones registradas.</p>
      <p style="font-size: 11px; margin-top: 8px;">¡Sé el primero! Únete a una quiniela y predice.</p>
      <a href="/pools" class="btn-primary" style="display: inline-block; margin-top: 20px; font-size: 11px; padding: 10px 24px;">Ver quinielas</a>
    </div>
```

---

## Verification

After applying all fixes, run the following in order:

```bash
# 1. TypeScript check — catches mismatched bindings and missing imports
npx tsc --noEmit

# 2. SvelteKit build — confirms no Svelte compile errors
npx vite build

# 3. Run dev server and spot-check the following manually:
#    - Dark mode: skeleton loaders should show gold shimmer (C-1)
#    - Light mode toggle: skeleton should use light bg (C-1)
#    - Bottom sheet (pool page ⋯ button): should have solid background (C-1 + L-5)
#    - Pool bracket page: 3rd-place selector buttons should have solid card background (C-2)
#    - Results page: changing the entry dropdown should reload predictions (C-3)
#    - Top bar on mobile: "En juego" badge should not flash on SSR (C-4)
#    - Bottom nav: vibrate + navigate should fire from a single click, no double Tab stop (H-6)
#    - Group predictions autosave: simulate network error — should show toast (H-7)
#    - Profile page: theme toggle should stay in sync with top-bar icon (H-4)
#    - Admin > Results tab: type scores and click Guardar — should save without DOM query (H-5)
#    - Bracket page: clicking + Nueva entrada should show the create form (L-6)
#    - Leaderboard (empty): should show "Ver quinielas" not "Iniciar sesión" (L-7)
#    - Leaderboard columns: header and rows should align (M-6)
#    - Pool page tabs: no flickering active state on fast navigation (H-2)

npx vite dev
```

```bash
# 4. Run existing test suite to catch regressions
npx vitest run
```

---

## Summary Table

| ID | File | Priority | Lines Changed |
|----|------|----------|---------------|
| C-1 | `src/app.css` | CRITICAL | +4 vars in `:root`, +4 vars in `[data-theme="light"]` |
| C-2 | `bracket/+page.svelte` | CRITICAL | 2 CSS property values |
| C-3 | `results/+page.svelte` | CRITICAL | +1 import, 1 attribute change |
| C-4 | `+layout.svelte` | CRITICAL | 1 condition expression |
| H-2 | `+layout.svelte` | HIGH | Replace 3 lines with 1 |
| H-3 | `+layout.svelte` | HIGH | Extract function, replace subscribe with $effect |
| H-4 | `profile/+page.svelte` | HIGH | Replace 1 line with 3 |
| H-5 | `admin/+page.svelte` | HIGH | 2 inputs + 1 onclick |
| H-6 | `app.css` + `+layout.svelte` | HIGH | Rename 3 CSS selectors, replace HTML structure |
| H-7 | `predict/+page.svelte` | HIGH | +1 import, expand catch block |
| M-1 | `bracket/+page.svelte` | MEDIUM | Replace 2 deep-clone derived |
| M-3 | `pool/[id]/+page.svelte` | MEDIUM | Remove 2 lines |
| M-4 | `pool/[id]/+page.svelte` | MEDIUM | Remove dead branch |
| M-5 | `pool/[id]/+page.svelte` | MEDIUM | Replace 2 functions + 4 call sites |
| M-6 | `leaderboard/+page.svelte` | MEDIUM | 2 grid-template + 1 header cell |
| M-7 | `pool/[id]/+page.svelte` | MEDIUM | +3 attributes to overlay div |
| M-8 | `bracket/+page.svelte` | MEDIUM | Delete 10-line function |
| M-9 | `app.css` | MEDIUM | +1 CSS property |
| M-10 | `admin/+page.svelte` | MEDIUM | 1 string |
| L-1 | `join/[code]/+page.svelte` | LOW | Replace $effect with onMount |
| L-2 | `login/+page.svelte` | LOW | +1 attribute |
| L-3 | `predict/+page.svelte` | LOW | DEFERRED |
| L-4 | `PullToRefresh.svelte` | LOW | DEFERRED |
| L-5 | `app.css` | LOW | 1 CSS fallback value |
| L-6 | `bracket/+page.svelte` | LOW | +1 state var + 4 small changes |
| L-7 | `leaderboard/+page.svelte` | LOW | 2 lines |
| H-1 | `app.html` | HIGH | MOOT — already present |
| L-8 | `app.html` | LOW | MOOT — already present |
| M-2 | `admin/+page.svelte` | MEDIUM | DEFERRED — works correctly |
