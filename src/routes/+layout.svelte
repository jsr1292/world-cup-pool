<script lang="ts">
  import { browser } from '$app/environment';
  import { haptic } from '$lib/haptic';
  import { onNavigate } from '$app/navigation';
  import { toast } from '$lib/toast';
  import '../app.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { headerTitle } from '$lib/stores/header';

  let fading = $state(false);
  let fadeTimer: ReturnType<typeof setTimeout>;
  onNavigate(() => {
    fading = true;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { fading = false; }, 200);
    // Scroll to top on navigation
    if (browser) window.scrollTo(0, 0);
  });
  let { children, data } = $props();

  // Register service worker for PWA
  if (browser && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let currentPath = $state('');
  let header = $state({ text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null });
  $effect(() => {
    currentPath = $page.url.pathname;
  });
  $effect(() => {
    const u = $page.url;
    const p = u.pathname;
    if (p === '/') {
      header = { text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null };
    } else if (p === '/leaderboard') {
      header = { text: 'Clasificación', emoji: '📊', showBack: false, poolName: null, poolEmoji: null };
    } else if (p === '/profile') {
      header = { text: 'Perfil', emoji: '👤', showBack: false, poolName: null, poolEmoji: null };
    } else if (p.startsWith('/pool/') && !p.includes('/bracket')) {
      // Pool detail — use store values set by the child page
      const unsub = headerTitle.subscribe(h => { header = { ...header, ...h }; });
      return unsub;
    } else if (p.startsWith('/pool/') && p.includes('/bracket')) {
      header = { text: 'Mi Quiniela', emoji: '⚔️', showBack: true, poolName: null, poolEmoji: null };
    } else {
      header = { text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null };
    }
  });

  // ─── Swipe-to-go-back (iOS edge swipe) ────────────────────────
  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = $state(false);
  let swipeOffset = $state(0);

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    if (x > 30) return; // Only trigger from left edge
    if (window.history.length <= 1) return;
    // Don't interfere with bracket drag operations
    const target = e.target as HTMLElement;
    if (target.closest('[draggable="true"]') || target.closest('.team-btn')) return;
    touchStartX = x;
    touchStartY = e.touches[0].clientY;
  }

  function onTouchMove(e: TouchEvent) {
    if (touchStartX === 0) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    // Only track rightward swipes
    if (dx < 0) { touchStartX = 0; swipeOffset = 0; swiping = false; return; }
    // Require mostly horizontal movement
    if (Math.abs(dy) > Math.abs(dx) * 1.5) return;
    swipeOffset = Math.min(dx, 80);
    swiping = dx > 10;
    if (dx > 60) {
      e.preventDefault();
      window.history.back();
      touchStartX = 0;
      swipeOffset = 0;
      swiping = false;
    }
  }

  function onTouchEnd() {
    touchStartX = 0;
    swipeOffset = 0;
    swiping = false;
  }

  function isActive(path) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  }

  const navItems = [
    { path: '/', label: 'Inicio', icon: 'home' },
    { path: '/leaderboard', label: 'Clasificación', icon: 'trophy' },
    ...(data?.user?.is_admin ? [{ path: '/admin', label: 'Admin', icon: 'settings' }] : []),
    { path: '/profile', label: 'Perfil', icon: 'user' },
  ];

  // ─── Countdown timer ────────────────────────────────────────────────────────
  let countdownDays = $state('');
  let countdownHours = $state('');
  let countdownLive = $state(false);

  $effect(() => {
    const kickoff = new Date('2026-06-11T00:00:00Z');
    function update() {
      const diff = kickoff.getTime() - Date.now();
      if (diff <= 0) {
        countdownDays = '0';
        countdownHours = '0';
        countdownLive = true;
        return;
      }
      countdownLive = false;
      countdownDays = String(Math.floor(diff / (1000 * 60 * 60 * 24)));
      countdownHours = String(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
    }
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  });
</script>

<div class="app-layout" style="height: 100vh; padding-bottom: 0;">
  <!-- Top Bar (mobile only) -->
  {#if data?.user}
    <header class="top-bar">
      <div class="top-bar-inner">
        <div class="top-bar-brand">
          {#if header.showBack}
            <button onclick={() => history.back()} style="background:none;border:none;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;padding:0;font-size:16px;line-height:1;">←</button>
          {/if}
          {#if header.poolEmoji}
            <span style="font-size:16px;">{header.poolEmoji}</span>
          {:else}
            <span style="font-size:16px;">{header.emoji}</span>
          {/if}
          {#if header.poolName}
            <span style="font-size:13px;font-weight:600;">{header.poolName}</span>
          {:else}
            <span>{header.text}</span>
          {/if}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          {#if countdownDays !== '' && typeof window !== 'undefined'}
            {#if countdownLive}
              <div class="countdown live">⚽ En juego</div>
            {:else}
              <div class="countdown" title="11 de junio de 2026">
                {countdownDays} días
              </div>
            {/if}
          {/if}
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
        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, var(--gold), #b8943f); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;">🏆</div>
        <div>
          <div style="font-family: 'Libre Baskerville', serif; font-size: 17px; color: var(--gold); line-height: 1.2;">Mundial 2026</div>
          <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px;">Quiniela</div>
        </div>
      </div>
    </div>

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
      <form method="POST" action="/api/auth/logout">
        <button type="submit" class="btn-ghost" style="width: 100%; font-size: 9px; padding: 8px;">
          Cerrar sesión
        </button>
      </form>
    </div>
  </nav>
  {/if}

  <!-- Main Content -->
  <main
    class="main-content"
    style="transition: opacity 0.15s ease, transform 0.05s ease; opacity: {fading ? 0 : 1}; transform: translateX({swipeOffset}px); touch-action: pan-y;"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    {@render children()}
  </main>

  <!-- Toast -->
  {#if $toast}
    <div class="toast">{$toast}</div>
  {/if}

</div>

<!-- Mobile Bottom Nav — OUTSIDE the wrapper so position:fixed is truly viewport-relative -->
{#if data?.user}
<div class="bottom-nav">
  {#each navItems as item}
    <a href={item.path}>
      <button class:active={isActive(item.path)} onclick={() => haptic(8)}>
        <svg class="nav-icon-mobile"><use href="/icon.svg#{item.icon}" /></svg>
        <span class="nav-label">{item.label}</span>
      </button>
    </a>
  {/each}
</div>
{/if}

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
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    display: block;
    margin: 0 auto 2px;
  }

  .nav-label {
    font-size: 9px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Mobile top bar */
  .top-bar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgba(13,17,32,0.80);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(201, 168, 76, 0.12);
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
    font-weight: 700;
    letter-spacing: 0.02em;
    background: linear-gradient(135deg, #e8c96a 0%, #c9a84c 40%, #f0d98c 60%, #b8943f 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .top-bar-brand svg {
    filter: drop-shadow(0 0 4px rgba(201, 168, 76, 0.4));
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
  .top-bar-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(13, 17, 32, 0.8);
    border: 2px solid transparent;
    background-image: linear-gradient(rgba(13, 17, 32, 0.8), rgba(13, 17, 32, 0.8)), linear-gradient(135deg, #e8c96a, #c9a84c, #b8943f);
    background-origin: border-box;
    background-clip: padding-box, border-box;
    color: var(--gold);
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .top-bar-avatar:hover {
    box-shadow: 0 0 8px rgba(201, 168, 76, 0.3);
  }

  /* Desktop: hide top bar, show sidebar */
  @media (min-width: 768px) {
    .top-bar { display: none; }
  }
</style>
