<script>
  import { browser } from '$app/environment';
  import { onNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import '../app.css';
  import { page } from '$app/stores';

  let fading = $state(false);
  onNavigate(() => {
    fading = true;
    return () => { fading = false; };
  });
  let { children, data } = $props();

  // PWA service worker disabled during development — re-enable for production builds
  // if (browser && 'serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }

  let currentPath = $state('');
  $effect(() => {
    currentPath = $page.url.pathname;
  });

  function isActive(path) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  }

  // Theme toggle
  let isDark = $state(true);
  $effect(() => {
    if (!browser) return;
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
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
          {#if typeof window !== 'undefined'}
            {@const kickoff = new Date('2026-06-11T00:00:00Z')}
            {@const now = Date.now()}
            {@const diff = kickoff.getTime() - now}
            {#if diff > 0}
              <div class="countdown" title="11 de junio de 2026">
                {Math.ceil(diff / (1000 * 60 * 60 * 24))} días
              </div>
            {:else if diff > -(1000 * 60 * 60 * 24 * 35)}
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
  <main class="main-content" style="transition: opacity 0.15s ease; opacity: {fading ? 0 : 1};">
    {@render children()}
  </main>

</div>

<!-- Mobile Bottom Nav — OUTSIDE the wrapper so position:fixed is truly viewport-relative -->
{#if data?.user}
<div class="bottom-nav">
  {#each navItems as item}
    <a href={item.path}>
      <button class:active={isActive(item.path)}>
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
    background: var(--bg-nav);
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
    background: var(--bg-card);
    border: 2px solid transparent;
    background-image: linear-gradient(var(--bg-card), var(--bg-card)), linear-gradient(135deg, #e8c96a, #c9a84c, #b8943f);
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
</style>
