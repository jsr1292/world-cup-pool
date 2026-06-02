<script>
  import { browser } from '$app/environment';
  import '../app.css';
  import { page } from '$app/stores';
  import { toast } from '$lib/toast.js';
  import { logout } from '$lib/logout.js';
  import { WORLD_CUP_KICKOFF_MS, WORLD_CUP_DURATION_MS } from '$lib/constants.js';

  let { children, data } = $props();

  // PWA service worker disabled during development — re-enable for production builds
  // if (browser && 'serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }

  const currentPath = $derived($page.url.pathname);

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
    { path: '/', label: 'Inicio', icon: 'home' },
    { path: '/leaderboard', label: 'Clasificación', icon: 'trophy' },
    ...(data?.user?.is_admin ? [{ path: '/admin', label: 'Admin', icon: 'settings' }] : []),
    { path: '/profile', label: 'Perfil', icon: 'user' },
  ];
</script>

<div class="app-layout" style="height: 100vh; padding-bottom: 0;">
  <!-- Top Bar (mobile only) -->
  {#if data?.user}
    <header class="top-bar">
      <div class="top-bar-inner">
        <div class="top-bar-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#gold-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e8c96a"/><stop offset="50%" stop-color="#c9a84c"/><stop offset="100%" stop-color="#f0d98c"/></linearGradient></defs><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
          <span>Mundial 2026</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          {#if countdownText}
            <div class="countdown" title="11 de junio de 2026">
              {countdownText}
            </div>
          {:else if browser}
            {@const diff = WORLD_CUP_KICKOFF_MS - Date.now()}
            {#if diff > -WORLD_CUP_DURATION_MS}
              <div class="countdown live">⚽ En juego</div>
            {/if}
          {/if}
          <button onclick={toggleTheme} class="theme-toggle" title="Cambiar tema">
            {isDark ? '☀️' : '🌙'}
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
        <div style="width: 36px; height: 36px; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.22); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;">🏆</div>
        <div>
          <div style="font-family: 'Libre Baskerville', serif; font-size: 17px; color: var(--gold); line-height: 1.2;">Mundial 2026</div>
          <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px;">Quiniela</div>
        </div>
      </div>
    </div>

    {#if countdownText}
      <div class="sidebar-countdown" title="Primer partido · 11 de junio de 2026">
        <span class="sidebar-countdown-label">El Mundial arranca en</span>
        <span class="sidebar-countdown-value">{countdownText}</span>
      </div>
    {:else if browser}
      {@const diff = WORLD_CUP_KICKOFF_MS - Date.now()}
      {#if diff > -WORLD_CUP_DURATION_MS}
        <div class="sidebar-countdown"><span class="sidebar-countdown-value live">⚽ En juego</span></div>
      {/if}
    {/if}

    <div class="sidebar-nav">

    {#each navItems as item}
      <a
        href={item.path}
        class="nav-link"
        class:active={isActive(item.path)}
      >
        <svg class="nav-icon"><use href="/icon.svg#{item.icon}" /></svg>
        {item.label}
      </a>
    {/each}

    {#if data?.user?.is_admin}
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
        <div style="font-size: 9px; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; padding: 0 12px 8px;">Administración</div>
        <a href="/admin" class="nav-link" class:active={currentPath.startsWith('/admin')}>
          <svg class="nav-icon"><use href="/icon.svg#settings" /></svg>
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
        {isDark ? '☀️ Modo claro' : '🌙 Modo oscuro'}
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

<!-- Mobile Bottom Nav — OUTSIDE the wrapper so position:fixed is truly viewport-relative -->
{#if data?.user}
<div class="bottom-nav">
  {#each navItems as item}
    <a href={item.path} class:active={isActive(item.path)} aria-label={item.label}
       onclick={() => { try { navigator.vibrate(5); } catch {} }}>
      <svg class="nav-icon-mobile"><use href="/icon.svg#{item.icon}" /></svg>
    </a>
  {/each}
</div>
{/if}

<!-- Phone landscape lock. The PWA manifest requests portrait (honored on
     Android); iOS ignores it, so on a touch phone held sideways we cover the UI
     and ask the user to rotate back — effectively portrait-only everywhere. -->
<div class="rotate-lock" aria-hidden="true">
  <div class="rotate-lock-inner">
    <div style="font-size: 34px;">🔄</div>
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
  }

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
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
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

  /* Portrait lock for touch phones (iOS ignores the manifest's orientation). */
  .rotate-lock { display: none; }
  @media (max-width: 820px) and (orientation: landscape) and (pointer: coarse) {
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
