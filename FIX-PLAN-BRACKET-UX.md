# FIX-PLAN-BRACKET-UX.md
## Bracket UX: Feed-Origin Labels + Mobile Tap-to-Highlight

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

Three features, applied in dependency order: CSS → Script constants → Script state → Template.

---

## Orientation: Cross-Wing QF Routing

```
R16_TO_QF = [4, 0, 7, 2, 1, 3, 5, 6]   (from recascade(), line 332)

QF[0] LEFT  wing: slot0 ← R16[4] (RIGHT, cross)  slot1 ← R16[0] (LEFT, same)
QF[1] LEFT  wing: slot0 ← R16[7] (RIGHT, cross)  slot1 ← R16[2] (LEFT, same)
QF[2] RIGHT wing: slot0 ← R16[1] (LEFT,  cross)  slot1 ← R16[3] (LEFT, cross)
QF[3] RIGHT wing: slot0 ← R16[5] (RIGHT, same)   slot1 ← R16[6] (RIGHT, same)

R32_TO_R16 = [0,1, 2,4, 3,5, 6,7, 10,11, 8,12, 9,13, 14,15]  (all same-wing)
```

---

## Step 1 — CSS (insert before closing `</style>`, after line 1719)

**Old** (line 1719, the last line of `<style>`):
```
  .team-tbd-btn:hover { text-decoration: underline; }
```

**New** (replace with same line + append new classes):
```svelte
  .team-tbd-btn:hover { text-decoration: underline; }

  /* Feed-origin labels: tiny R32/R16 source tags inside team slots */
  .feed-label {
    font-size: 7px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }
  .feed-label-cross {
    color: var(--gold);
    opacity: 0.85;
    font-weight: 600;
  }

  /* Tap-pinned state: gold outline on the team whose path is locked */
  .team-btn.path-pinned {
    outline: 1.5px solid rgba(201, 168, 76, 0.6);
    outline-offset: -1px;
  }
```

---

## Step 2 — Script: Feed-origin constants (insert after line 88)

**Old** (lines 87-89):
```javascript
  const FINAL_LABEL = 'W(SF-1) vs W(SF-2)';
  const THIRD_LABEL = 'L(SF-1) vs L(SF-2)';

  function r32Label(mi) { return R32_LABELS[mi] || `R32-${mi + 1}`; }
```

**New**:
```javascript
  const FINAL_LABEL = 'W(SF-1) vs W(SF-2)';
  const THIRD_LABEL = 'L(SF-1) vs L(SF-2)';

  // Feed-origin tables for QF and R16 label helpers below.
  // QF_FEED[qfIdx][teamSlot] = { idx: r16Index, cross: isOppositeWing }
  // Left-wing QFs are 0–1 (template slice(0,2)); right-wing QFs are 2–3.
  const QF_FEED = [
    [{ idx: 4, cross: true  }, { idx: 0, cross: false }],  // QF[0] LEFT wing
    [{ idx: 7, cross: true  }, { idx: 2, cross: false }],  // QF[1] LEFT wing
    [{ idx: 1, cross: true  }, { idx: 3, cross: true  }],  // QF[2] RIGHT wing
    [{ idx: 5, cross: false }, { idx: 6, cross: false }],  // QF[3] RIGHT wing
  ];

  // R16_FEED[r16Idx][teamSlot] = r32Index (0-based), all same-wing.
  // Derived from R32_TO_R16 = [0,1, 2,4, 3,5, 6,7, 10,11, 8,12, 9,13, 14,15].
  const R16_FEED = [
    [0, 1], [2, 4], [3, 5], [6, 7],      // R16[0-3] left wing
    [10, 11], [8, 12], [9, 13], [14, 15], // R16[4-7] right wing
  ];

  function r32Label(mi) { return R32_LABELS[mi] || `R32-${mi + 1}`; }
```

---

## Step 3 — Script: Feed-label helpers (insert after line 93)

**Old** (line 93):
```javascript
  function sfLabel(mi) { return SF_LABELS[mi] || `SF-${mi + 1}`; }
```

**New**:
```javascript
  function sfLabel(mi) { return SF_LABELS[mi] || `SF-${mi + 1}`; }

  // Returns compact feed-origin label for a QF team slot.
  // Desktop split layout: cross-wing feeds get a ← or → arrow.
  // Mobile linear layout: pass mobile=true to suppress arrows.
  function qfFeedLabel(mi, ti, mobile = false) {
    const feed = QF_FEED[mi]?.[ti];
    if (!feed) return null;
    const n = feed.idx + 1;
    if (mobile || !feed.cross) return `R16-${n}`;
    return mi < 2 ? `← R16-${n}` : `R16-${n} →`;
  }

  // Returns compact feed-origin label for an R16 team slot (always same-wing).
  function r16FeedLabel(mi, ti) {
    const r32Idx = R16_FEED[mi]?.[ti];
    if (r32Idx === undefined) return null;
    return `R32-${r32Idx + 1}`;
  }
```

---

## Step 4 — Script: Mobile pin state + reactive activeTeam

### 4a. Add pinnedTeam state (after line 508)

**Old** (line 508):
```javascript
  let hoveredTeam = $state(null); // team ID being hovered
```

**New**:
```javascript
  let hoveredTeam = $state(null); // team ID being hovered (desktop)
  let pinnedTeam  = $state(null); // team ID locked by tap (mobile)
  // Unified: tap-pinned takes precedence over hover.
  const activeTeam = $derived(pinnedTeam ?? hoveredTeam);
```

### 4b. Switch teamPath to use activeTeam (line 540)

**Old** (line 540):
```javascript
  const teamPath = $derived(getTeamPath(hoveredTeam, teams));
```

**New**:
```javascript
  const teamPath = $derived(getTeamPath(activeTeam, teams));
```

### 4c. Switch isInPath guard (line 543)

**Old** (line 543):
```javascript
    if (!hoveredTeam) return false;
```

**New**:
```javascript
    if (!activeTeam) return false;
```

---

## Step 5 — Template: bracket-scroll dismiss handler (line 748)

**Old** (line 748):
```svelte
  <div class="bracket-scroll">
```

**New**:
```svelte
  <div class="bracket-scroll" ontouchend={(e) => { if (!e.target.closest('.team-btn')) pinnedTeam = null; }}>
```

---

## Step 6 — Template: Desktop LEFT R16 buttons (lines 791–797)

The `{@const}` block inside `{#each [0, 1] as ti}` for the left-wing R16 (slice 0–4, lines 789–800).

**Old** (lines 791–797):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = r16FeedLabel(mi, ti)}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label">{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

---

## Step 7 — Template: Desktop LEFT QF buttons (lines 809–815)

Inside `{#each [0, 1] as ti}` for left-wing QF (slice 0–2, lines 806–819).

**Old** (lines 809–815):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = qfFeedLabel(mi, ti)}
                  {@const feedCross = QF_FEED[mi]?.[ti]?.cross}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label" class:feed-label-cross={feedCross}>{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

---

## Step 8 — Template: Desktop RIGHT QF buttons (lines 900–906)

Inside `{#each [0, 1] as ti}` for right-wing QF (slice 2–4 with `mi = idx + 2`, lines 896–910).

**Old** (lines 900–906):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = qfFeedLabel(mi, ti)}
                  {@const feedCross = QF_FEED[mi]?.[ti]?.cross}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label" class:feed-label-cross={feedCross}>{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

> Note: `mi` is already 2 or 3 here (from `{@const mi = idx + 2}`), so `qfFeedLabel(mi, ti)` and `QF_FEED[mi]` resolve to the right-wing entries automatically.

---

## Step 9 — Template: Desktop RIGHT R16 buttons (lines 920–926)

Inside `{#each [0, 1] as ti}` for right-wing R16 (slice 4–8 with `mi = idx + 4`, lines 916–929).

**Old** (lines 920–926):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = r16FeedLabel(mi, ti)}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label">{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

---

## Step 10 — Template: Mobile R16 buttons (lines 1006–1012)

Inside `{#each [0, 1] as ti}` for mobile R16 (full array, lines 1003–1015).

**Old** (lines 1006–1012):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.r16?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = r16FeedLabel(mi, ti)}
                  <button id={"btn-r16-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.r16?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('r16', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('r16', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label">{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

---

## Step 11 — Template: Mobile QF buttons (lines 1025–1031)

Inside `{#each [0, 1] as ti}` for mobile QF (full array, lines 1022–1034).

**Old** (lines 1025–1031):
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

**New**:
```svelte
                  {@const tid = match[ti]}
                  {@const t = teamMap[tid]}
                  {@const isPicked = explicitPicks.qf?.[mi]?.[ti]}
                  {@const canClick = !data.isLocked && tid !== null}
                  {@const feedLbl = qfFeedLabel(mi, ti, true)}
                  {@const feedCross = QF_FEED[mi]?.[ti]?.cross}
                  <button id={"btn-qf-"+mi+"-"+ti} class="team-btn" class:picked={isPicked} class:eliminated={explicitPicks.qf?.[mi]?.[1 - ti] && !isPicked && tid !== null} class:path-highlight={isInPath('qf', mi, ti)} class:path-pinned={pinnedTeam === tid && tid !== null} disabled={!canClick} onclick={() => canClick && pickTeam('qf', mi, ti, tid)} onmouseenter={() => { if (tid) hoveredTeam = tid; }} onmouseleave={() => { hoveredTeam = null; }} ontouchstart={() => { if (tid) pinnedTeam = (pinnedTeam === tid) ? null : tid; }}>
                    {#if t}<span class="team-flag">{flagEmoji(t.flag_code)}</span><span class="team-name">{shortName(t.name)}</span>{#if isPicked}<span class="pick-star">★</span>{/if}{#if feedLbl}<span class="feed-label" class:feed-label-cross={feedCross}>{feedLbl}</span>{/if}{:else}<span class="team-empty">—</span>{/if}
                  </button>
```

> `qfFeedLabel(mi, ti, true)` — the `true` flag suppresses ←/→ arrows in the linear mobile layout. `feed-label-cross` still applies gold styling to non-obvious cross-wing feeds.

---

## What Each Change Does

| Step | Change | Effect |
|------|--------|--------|
| 1 | `.feed-label`, `.feed-label-cross`, `.path-pinned` CSS | Visual foundation for labels and pinned state |
| 2 | `QF_FEED`, `R16_FEED` constants | Static truth table for feed routing |
| 3 | `qfFeedLabel()`, `r16FeedLabel()` helpers | Compute label strings with/without arrows |
| 4a | `pinnedTeam`, `activeTeam` state | Tap-pin state; unified hover+pin into activeTeam |
| 4b | `teamPath` → `activeTeam` | Path derived from pin OR hover |
| 4c | `isInPath` guard → `activeTeam` | Highlight works for both pin and hover |
| 5 | `bracket-scroll` `ontouchend` | Tapping outside any team-btn dismisses pin |
| 6–9 | Desktop R16/QF buttons | Feed labels + `ontouchstart` pin toggle + `path-pinned` class |
| 10–11 | Mobile R16/QF buttons | Same, but QF labels omit directional arrows |

## Mobile Tap UX Flow

```
User taps team A (nothing pinned):
  ontouchstart → pinnedTeam = teamA   [path lights up immediately]
  onclick → pickTeam(teamA)           [team marked as winner]

User taps team A again (teamA is pinned):
  ontouchstart → pinnedTeam = null    [path clears immediately]
  onclick → pickTeam(teamA) undo      [team deselected]

User taps elsewhere on bracket:
  bracket-scroll ontouchend → pinnedTeam = null
```

Hover on desktop is unchanged. `activeTeam = pinnedTeam ?? hoveredTeam` means the pin takes over when set, hover works when nothing is pinned.

## New State Variables Added

| Variable | Type | Location | Purpose |
|----------|------|----------|---------|
| `pinnedTeam` | `$state(null)` | line 509 | team ID locked by touch tap |
| `activeTeam` | `$derived` | line 511 | `pinnedTeam ?? hoveredTeam` |
| `QF_FEED` | `const Array` | line 91 | Cross-wing truth table for QF→R16 routing |
| `R16_FEED` | `const Array` | line 105 | R32→R16 routing (same-wing, all) |

## New CSS Classes

| Class | Applied to | Purpose |
|-------|-----------|---------|
| `.feed-label` | `span` inside `team-btn` | Dim 7px feed-origin badge |
| `.feed-label-cross` | modifier on `.feed-label` | Gold color for cross-wing connections |
| `.path-pinned` | `team-btn` modifier | Gold outline on tap-pinned team |

## Rendered Label Examples

```
Desktop LEFT QF (QF[0]):
  slot0: [🇫🇷 France ★  ← R16-5]   ← gold, cross-wing from right
  slot1: [🇧🇷 Brazil     R16-1  ]   ← dim, same-wing

Desktop RIGHT QF (QF[2]):
  slot0: [🇩🇪 Germany   R16-2 →]   ← gold, cross-wing from left
  slot1: [🇦🇷 Argentina  R16-4 →]   ← gold, cross-wing from left

Desktop R16 (R16[1]):
  slot0: [🏴󠁧󠁢󠁥󠁮󠁧󠁿 England   R32-3  ]   ← dim, no arrows (same-wing)
  slot1: [🇵🇹 Portugal   R32-5  ]   ← dim

Mobile QF (QF[0]):
  slot0: [🇫🇷 France    R16-5  ]   ← gold (cross), no arrow
  slot1: [🇧🇷 Brazil    R16-1  ]   ← dim (same)
```
