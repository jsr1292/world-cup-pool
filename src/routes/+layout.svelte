<script>
  import '../app.css';
  import { page } from '$app/stores';
  let { children, data } = $props();

  let currentPath = $state('');
  $effect(() => {
    currentPath = $page.url.pathname;
  });

  function isActive(path) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  }

  const navItems = [
    { path: '/', label: 'Inicio', icon: 'home' },
    { path: '/profile', label: 'Perfil', icon: 'user' },
  ];
</script>

<div class="app-layout">
  <!-- Top Bar (mobile only) -->
  {#if data?.user}
    <header class="top-bar">
      <div class="top-bar-inner">
        <div class="top-bar-brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--gold);"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
          <span>Mundial 2026</span>
        </div>
        <a href="/profile" class="top-bar-avatar" title="Perfil">
          {data.user.display_name?.charAt(0).toUpperCase() ?? '?'}
        </a>
      </div>
    </header>
  {/if}

  <!-- Desktop Sidebar -->
  {#if data?.user}
  <nav class="sidebar">
    <div style="padding: 0 8px 20px; border-bottom: 1px solid var(--border); margin-bottom: 16px;">
      <div style="font-family: 'Libre Baskerville', serif; font-size: 16px; color: var(--gold); margin-bottom: 4px;">Mundial</div>
      <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase;">Quiniela 2026</div>
    </div>

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
        <div style="font-size: 8px; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; padding: 0 12px 8px;">Admin</div>
        <a href="/admin" class="nav-link" class:active={currentPath.startsWith('/admin')}>
          <svg class="nav-icon"><use href="/icon.svg#settings" /></svg>
          Ajustes
        </a>
      </div>
    {/if}

    <div style="position: absolute; bottom: 16px; left: 12px; right: 12px;">
      <form method="POST" action="/api/auth/logout">
        <button type="submit" class="btn-ghost" style="width: 100%; font-size: 10px;">
          Cerrar sesión
        </button>
      </form>
    </div>
  </nav>
  {/if}

  <!-- Main Content -->
  <main class="main-content">
    {@render children()}
  </main>

  <!-- Mobile Bottom Nav -->
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
    font-size: 8px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Mobile top bar */
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    background: var(--bg-base);
    backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--border);
  }

  .top-bar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
  }

  .top-bar-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Libre Baskerville', serif;
    font-size: 14px;
    color: var(--gold);
  }

  .top-bar-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(201, 168, 76, 0.2);
    border: 1px solid rgba(201, 168, 76, 0.4);
    color: var(--gold);
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s;
  }

  .top-bar-avatar:hover {
    background: rgba(201, 168, 76, 0.3);
  }

  /* Desktop: hide top bar, show sidebar */
  @media (min-width: 768px) {
    .top-bar { display: none; }
  }
</style>
