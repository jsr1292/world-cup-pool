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
    { path: '/pools', label: 'Inicio', icon: 'home' },
    { path: '/profile', label: 'Perfil', icon: 'user' },
  ];
</script>

<div class="app-layout">
  {#if data?.user}
  <!-- Desktop Sidebar -->
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
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
