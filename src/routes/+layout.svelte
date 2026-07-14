<script>
  import { browser } from '$app/environment';
  import '../app.css';
  import { page } from '$app/stores';
  import { invalidateAll, onNavigate } from '$app/navigation';
  import { toast } from '$lib/toast.js';
  import { logout } from '$lib/logout.js';
  import { WORLD_CUP_KICKOFF_MS, WORLD_CUP_DURATION_MS } from '$lib/constants.js';
  import LiveTicker from '$lib/LiveTicker.svelte';
  import NextMatch from '$lib/NextMatch.svelte';
  import InstallPrompt from '$lib/InstallPrompt.svelte';
  import BackToTop from '$lib/BackToTop.svelte';
  import Icon from '$lib/Icon.svelte';
  import { liveMatchIds } from '$lib/live.js';

  let { children, data } = $props();
  import { onMount, onDestroy } from 'svelte';

  // PWA service worker. Navigations are network-first (see static/sw.js) so
  // content stays fresh; when an UPDATED worker takes control we reload once so
  // nobody is stuck on a stale shell. No reload on the very first install
  // (there was no prior controller), to avoid a jarring reload on first visit.
  if (browser && 'serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloaded || !hadController) return;
      swReloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Self-heal blank pages: if a lazily-loaded route chunk fails to load (a
  // transient network blip, or a deploy that rotated chunk hashes mid-session),
  // the page can render blank. Reload once to fetch the current build instead of
  // leaving an empty screen. Guarded per-session so it can never loop.
  if (browser) {
    window.addEventListener('vite:preloadError', () => {
      try {
        if (sessionStorage.getItem('preload-reloaded')) return;
        sessionStorage.setItem('preload-reloaded', '1');
      } catch { /* private mode — reload anyway */ }
      location.reload();
    });
    // Auto-hide the top bar based on scroll direction (mobile only — the bar is
    // display:none on desktop, so the transform is a no-op there).
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 12) topHidden = false;
      else if (y > lastY + 5) topHidden = true;
      else if (y < lastY - 5) topHidden = false;
      lastY = y;
      // Mirror the collapsed state onto <html> so sibling chrome (the BackToTop
      // FAB) can drop into the reclaimed corner in pure CSS.
      document.documentElement.classList.toggle('nav-collapsed', topHidden);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Live-score ticker (single poller, shared by the top-bar + sidebar) ──────
  /** @type {any[]} */
  let liveMatches = $state([]);
  /** @type {any} */
  let nextMatch = $state(null);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let liveTimer = null;
  // Auto-hide the mobile top bar on scroll-down (more screen), reveal on scroll-up.
  let topHidden = $state(false);

  // Cross-fade between pages via the View Transitions API (the CSS keyframes live
  // in app.css). No-op where unsupported or when the user prefers reduced motion.
  onNavigate((navigation) => {
    if (typeof document === 'undefined' || !document.startViewTransition) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
  const inTournamentWindow = () => {
    const now = Date.now();
    return now >= WORLD_CUP_KICKOFF_MS && now <= WORLD_CUP_KICKOFF_MS + WORLD_CUP_DURATION_MS;
  };
  // Adaptive cadence — fast only when it matters, so quiet hours/days are cheap.
  function nextPollDelay() {
    if (liveMatches.length > 0) return 30_000;                         // a game is live
    const k = nextMatch?.kickoff_time ? new Date(nextMatch.kickoff_time).getTime() : null;
    if (k != null && k - Date.now() < 3_600_000) return 60_000;        // next match within 1h
    return 300_000;                                                    // nothing near → 5 min
  }
  function scheduleLive(/** @type {number} */ ms) { if (liveTimer) clearTimeout(liveTimer); liveTimer = setTimeout(pollLive, ms); }
  // Self-scheduling poller. Skips the fetch (and therefore the server DB hit)
  // while the app is backgrounded — the biggest client-side compute saver.
  async function pollLive() {
    if (!inTournamentWindow()) { liveMatches = []; nextMatch = null; liveMatchIds.set(new Set()); scheduleLive(600_000); return; }
    if (typeof document !== 'undefined' && document.hidden) { scheduleLive(nextPollDelay()); return; }
    try {
      const r = await fetch('/api/live');
      if (r.ok) {
        const d = await r.json();
        liveMatches = Array.isArray(d.matches) ? d.matches : [];
        nextMatch = d.next ?? null;
        // Publish in-play match ids so other pages (e.g. Calendario) can react.
        liveMatchIds.set(new Set(liveMatches.map((m) => m.match_id).filter((x) => x != null)));
      }
    } catch { /* keep last */ }
    scheduleLive(nextPollDelay());
  }
  onMount(() => {
    if (!browser || !data?.user || !inTournamentWindow()) return;
    pollLive(); // self-schedules
    const onVis = () => { if (document.visibilityState === 'visible') pollLive(); };
    document.addEventListener('visibilitychange', onVis);
    onDestroy(() => document.removeEventListener('visibilitychange', onVis));
  });
  onDestroy(() => { if (liveTimer) clearTimeout(liveTimer); });

  const currentPath = $derived($page.url.pathname);
  // The pool hub (/pool/<id>) renders its own chat-coordinated back-to-top FAB,
  // so suppress the global one there to avoid two overlapping buttons. Long
  // sub-pages (predict, bracket, …) still get the global FAB.
  const isPoolHub = $derived(/^\/pool\/[^/]+$/.test(currentPath));

  function isActive(path) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  }

  // Theme toggle
  let isDark = $state(
    browser ? document.documentElement.getAttribute('data-theme') !== 'light' : true
  );
  $effect(() => {
    if (!browser) return;
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  });

  // ── Pull-to-refresh (touch only) ───────────────────────────────────────────
  // Drag down from the very top of the page to re-run the current route's load
  // functions via invalidateAll(). Window is the scroller on mobile.
  let ptrY = $state(0);           // visual offset of the indicator while pulling
  let ptrActive = $state(false);  // finger is dragging a pull
  let refreshing = $state(false); // invalidateAll() in flight
  const PTR_THRESHOLD = 64;       // px of pull (post-resistance) to trigger
  const PTR_MAX = 90;

  $effect(() => {
    if (!browser) return;
    let startY = null;            // gesture start Y, or null when not eligible
    let startX = 0;               // gesture start X, to tell horizontal swipes apart
    /** @type {'h' | 'v' | null} */
    let locked = null;            // gesture direction once decided

    const onStart = (e) => {
      locked = null;
      if (refreshing || e.touches.length !== 1) { startY = null; return; }
      // Only arm when already scrolled to the very top.
      startY = window.scrollY <= 0 ? e.touches[0].clientY : null;
      startX = e.touches[0].clientX;
    };
    const onMove = (e) => {
      if (startY == null || refreshing) return;
      // A second finger landing mid-pull would jump touches[0] and fake a big
      // delta — bail out of the gesture instead.
      if (e.touches.length !== 1) { ptrActive = false; ptrY = 0; startY = null; return; }
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // Decide the gesture direction once it's moved enough, then stick with it.
      // A horizontal swipe (e.g. the scrollable tab bar) must NOT be hijacked by
      // pull-to-refresh — otherwise it feels stuck and takes a few tries.
      if (locked == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (locked === 'h') { ptrActive = false; ptrY = 0; return; } // let the tabs scroll
      if (dy <= 0 || window.scrollY > 0) { ptrActive = false; ptrY = 0; return; }
      // Resistance curve so the pull feels rubbery and never runs away.
      ptrY = Math.min(dy * 0.5, PTR_MAX);
      ptrActive = true;
      if (e.cancelable) e.preventDefault(); // suppress native overscroll while pulling
    };
    const onEnd = async () => {
      if (startY == null) return;
      const trigger = ptrActive && ptrY >= PTR_THRESHOLD;
      startY = null;
      ptrActive = false;
      if (trigger) {
        refreshing = true;
        ptrY = 56; // rest position while the spinner shows
        try { await invalidateAll(); } finally {
          refreshing = false;
          ptrY = 0;
        }
      } else {
        ptrY = 0;
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  });

  // Live countdown
  let countdownText = $state('');
  $effect(() => {
    if (!browser) return;
    const kickoff = WORLD_CUP_KICKOFF_MS;
    let iv;
    const update = () => {
      const diff = kickoff - Date.now();
      // §4.6 — Halt the interval once kickoff has passed instead of letting
      // setInterval keep firing every second forever.
      if (diff <= 0) {
        countdownText = '';
        if (iv) { clearInterval(iv); iv = null; }
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      countdownText = d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
    };
    update();
    iv = setInterval(update, 1000);
    return () => { if (iv) clearInterval(iv); };
  });
  function toggleTheme() {
    if (!browser) return;
    const theme = isDark ? 'light' : '';
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
    isDark = !isDark;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = isDark ? '#07090f' : '#f5f5f0';
  }

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

  // §4.9 — The $effect below already runs once on mount (it reads $page),
  // so the onMount stagger() is redundant. Keep only the effect.
  $effect(() => {
    $page; // reactive dependency — re-run stagger after each navigation
    setTimeout(stagger, 100);
  });

  const navItems = [
    // `?h=1` forces the home list to show — single-pool users are otherwise
    // redirected straight into their pool, so this keeps "Inicio" reaching the
    // create/join screen instead of bouncing back to the pool.
    { path: '/', href: '/?h=1', label: 'Inicio', icon: 'home' },
    // No global cross-pool leaderboard: pools are independent contests with their
    // own scoring, so a summed global board just rewarded being in more pools.
    // Each pool's own Clasificación tab is the real ranking.
    ...(data?.user?.is_admin ? [{ path: '/admin', href: '/admin', label: 'Admin', icon: 'settings' }] : []),
    { path: '/profile', href: '/profile', label: 'Perfil', icon: 'user' },
  ];
</script>

<InstallPrompt />
{#if data?.user && !isPoolHub}<BackToTop />{/if}

<div class="app-layout" style="height: 100vh; padding-bottom: 0;">
  <!-- Top Bar (mobile only) -->
  {#if data?.user}
    <!-- Frosted strip behind the iOS status bar. Height is 0 in a browser tab
         (safe-area inset 0), so it only shows in the installed PWA — where it
         stays put while the top bar auto-hides, masking content that would
         otherwise scroll under the notch. Sits just below the top bar (z:50). -->
    <div class="statusbar-fill" aria-hidden="true"></div>
    <header class="top-bar" class:top-hidden={topHidden}>
      <div class="top-bar-inner">
        <div class="top-bar-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#gold-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e8c96a"/><stop offset="50%" stop-color="#c9a84c"/><stop offset="100%" stop-color="#f0d98c"/></linearGradient></defs><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
          <!-- Hide the wordmark while live scores are showing, to free up width -->
          {#if liveMatches.length === 0}<span>Mundial 2026</span>{/if}
        </div>
        {#if liveMatches.length > 0}
          <div class="top-bar-live"><LiveTicker matches={liveMatches} /></div>
        {/if}
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          {#if liveMatches.length === 0}
            {#if countdownText}
              <div class="countdown" title="11 de junio de 2026">{countdownText}</div>
            {:else if nextMatch}
              <NextMatch match={nextMatch} />
            {/if}
          {/if}
          <button onclick={toggleTheme} class="theme-toggle" title="Cambiar tema" aria-label="Cambiar tema">
            <Icon name={isDark ? 'sun' : 'moon'} size={17} />
          </button>
          <a href="/profile" class="top-bar-avatar" title="Perfil">
            {data.user.display_name?.charAt(0).toUpperCase() ?? '?'}
          </a>
        </div>
      </div>
    </header>
  {/if}

  <!-- Desktop Sidebar -->
  {#if data?.user}
  <nav class="sidebar">
    <div class="sidebar-header">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 36px; height: 36px; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.22); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--gold);"><Icon name="trophy" size={20} /></div>
        <div>
          <div style="font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 18px; color: var(--gold); line-height: 1.2;">Mundial 2026</div>
          <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px;">Quiniela</div>
        </div>
      </div>
    </div>

    {#if liveMatches.length > 0}
      <div class="sidebar-countdown" style="overflow: hidden;"><LiveTicker matches={liveMatches} /></div>
    {:else if countdownText}
      <div class="sidebar-countdown" title="Primer partido · 11 de junio de 2026">
        <span class="sidebar-countdown-label">El Mundial arranca en</span>
        <span class="sidebar-countdown-value">{countdownText}</span>
      </div>
    {:else if nextMatch}
      <div class="sidebar-countdown" style="overflow: hidden;"><NextMatch match={nextMatch} variant="sidebar" /></div>
    {/if}

    <div class="sidebar-nav">

    {#each navItems as item}
      <a
        href={item.href}
        class="nav-link"
        class:active={isActive(item.path)}
      >
        <Icon name={item.icon} size={18} stroke={2} />
        {item.label}
      </a>
    {/each}

    {#if data?.user?.is_admin}
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
        <div style="font-size: 9px; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; padding: 0 12px 8px;">Administración</div>
        <a href="/admin" class="nav-link" class:active={currentPath.startsWith('/admin')}>
          <Icon name="settings" size={18} stroke={2} />
          Ajustes
        </a>
      </div>
    {/if}

    </div>

    <div class="sidebar-footer">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 8px 6px;">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: rgba(201,168,76,0.15); border: 1px solid rgba(201,168,76,0.3); color: var(--gold); font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
          {data.user?.display_name?.[0]?.toUpperCase() || '?'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 11px; color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{data.user?.display_name}</div>
          <div style="font-size: 9px; color: var(--text-dim);">@{data.user?.username}</div>
        </div>
      </div>
      <button type="button" onclick={toggleTheme} class="btn-ghost" style="width: 100%; font-size: 9px; padding: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 6px;">
        <Icon name={isDark ? 'sun' : 'moon'} size={13} /> {isDark ? 'Modo claro' : 'Modo oscuro'}
      </button>
      <button type="button" onclick={logout} class="btn-ghost" style="width: 100%; font-size: 9px; padding: 8px;">
        Cerrar sesión
      </button>
    </div>
  </nav>
  {/if}

  <!-- Main Content -->
  <main class="main-content" class:full-bleed={!data?.user}>
    {@render children()}
  </main>

{#if $toast}
  <div class="toast">{$toast}</div>
{/if}

</div>

<!-- Pull-to-refresh indicator (touch). Hidden above the fold until pulled. -->
{#if browser}
  <div class="ptr-indicator" class:ptr-snap={!ptrActive}
    style="transform: translateX(-50%) translateY({ptrY}px); opacity: {Math.min(ptrY / PTR_THRESHOLD, 1)};">
    <svg class="ptr-spinner" class:spin={refreshing} width="20" height="20" viewBox="0 0 24 24"
      style={refreshing ? '' : `transform: rotate(${ptrY * 3}deg);`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--gold)" stroke-width="2.5"
        stroke-linecap="round" stroke-dasharray="42" stroke-dashoffset="14" />
    </svg>
  </div>
{/if}

<!-- Mobile Bottom Nav — OUTSIDE the wrapper so position:fixed is truly viewport-relative -->
{#if data?.user}
<div class="bottom-nav" class:nav-hidden={topHidden}>
  {#each navItems as item}
    <a href={item.href} class:active={isActive(item.path)} aria-label={item.label}
       onclick={() => { try { navigator.vibrate(5); } catch {} }}>
      <Icon name={item.icon} size={24} stroke={2} />
    </a>
  {/each}
</div>
{/if}

<!-- Phone landscape lock. The PWA manifest requests portrait (honored on
     Android); iOS ignores it, so on a touch phone held sideways we cover the UI
     and ask the user to rotate back — effectively portrait-only everywhere. -->
<div class="rotate-lock" aria-hidden="true">
  <div class="rotate-lock-inner">
    <div style="color: var(--gold);"><Icon name="rotate" size={34} /></div>
    <p>Gira el teléfono a vertical</p>
  </div>
</div>

<style>
  .nav-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 6px;
    margin-bottom: 2px;
    font-size: 12px;
    color: var(--text-muted);
    text-decoration: none;
    transition: all 0.15s;
  }
  .nav-link:hover { color: var(--text); background: rgba(255,255,255,0.03); }
  .nav-link.active { color: var(--gold); background: rgba(201,168,76,0.08); }

  .nav-icon {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nav-icon-mobile {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    display: block;
    margin: 0 auto;
  }

  /* Mobile top bar */
  .statusbar-fill {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: env(safe-area-inset-top, 0px);
    z-index: 49;
    background: var(--bg-nav);
    backdrop-filter: blur(20px) saturate(1.6);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    pointer-events: none;
  }
  /* No notch / no mobile top bar on desktop — never paint the strip there. */
  @media (min-width: 768px) {
    .statusbar-fill { display: none; }
  }

  .top-bar {
    /* Fixed (not sticky) so it stays anchored to the viewport top — a sticky bar
       rubber-bands down with the content on iOS overscroll, and because it leaves
       the normal flow the main-content padding-top is the single correct offset
       (sticky double-counted, leaving a big gap). */
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--bg-nav);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    padding: max(12px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left));
    transition: transform 0.25s ease;
  }
  .top-bar.top-hidden { transform: translateY(-100%); }

  .top-bar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 36px;
  }

  .top-bar-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Archivo', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
    flex-shrink: 0;
  }

  /* When live scores are showing, the ticker takes the flexible middle space. */
  .top-bar-live {
    flex: 1;
    min-width: 0;
    margin: 0 10px;
    overflow: hidden;
  }

  .countdown {
    font-size: 11px;
    color: var(--gold);
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 12px;
    background: rgba(201,168,76,0.06);
    white-space: nowrap;
  }
  .countdown.live {
    color: var(--green);
    border-color: rgba(0,229,160,0.2);
    background: rgba(0,229,160,0.06);
  }
  .sidebar-countdown {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 4px 0 14px;
    padding: 10px 12px;
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 10px;
    background: rgba(201,168,76,0.06);
  }
  .sidebar-countdown-label {
    font-size: 9px;
    color: var(--text-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .sidebar-countdown-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--gold);
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
  }
  .sidebar-countdown-value.live { color: var(--green); }
  .top-bar-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-card);
    border: 1px solid rgba(201, 168, 76, 0.3);
    color: var(--gold);
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .top-bar-avatar:hover {
    border-color: rgba(201, 168, 76, 0.6);
  }

  .theme-toggle {
    background: none; border: none; cursor: pointer;
    font-size: 16px; padding: 4px;
    opacity: 0.7; transition: opacity 0.15s;
    line-height: 1;
  }
  .theme-toggle:hover { opacity: 1; }

  /* Desktop: hide top bar, show sidebar */
  @media (min-width: 768px) {
    .top-bar { display: none; }
  }

  /* Pull-to-refresh indicator */
  .ptr-indicator {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 4px);
    left: 50%;
    margin-top: -46px; /* parked above the fold; slides in via translateY */
    z-index: 60;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-card-solid);
    border: 1px solid var(--border);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    pointer-events: none;
  }
  .ptr-indicator.ptr-snap { transition: transform 0.25s ease, opacity 0.25s ease; }
  .ptr-spinner.spin { animation: ptr-spin 0.7s linear infinite; transform-origin: 50% 50%; }
  @keyframes ptr-spin { to { transform: rotate(360deg); } }

  /* Portrait lock for touch phones (iOS ignores the manifest's orientation).
     Gate on max-HEIGHT: in landscape a phone's width is its long edge (often
     >820px on modern iPhones), so a max-width rule never matched. The short
     edge (height) in landscape is ~375–430px on phones and ≥600px on tablets,
     so max-height cleanly targets phones only. */
  .rotate-lock { display: none; }
  @media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) {
    .rotate-lock {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 9999;
      align-items: center;
      justify-content: center;
      text-align: center;
      background: var(--bg);
    }
    .rotate-lock-inner p {
      margin-top: 10px;
      font-size: 13px;
      color: var(--text-muted);
      letter-spacing: 0.04em;
    }
  }
</style>
