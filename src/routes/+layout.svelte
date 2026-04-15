<script>
  import '../app.css';
  let { children, data } = $props();
  let currentPath = $state('');

  // Get current path from browser
  if (typeof window !== 'undefined') {
    currentPath = window.location.pathname;
    $effect(() => {
      currentPath = window.location.pathname;
    });
  }

  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/pools', label: 'Pools', icon: '⚽' },
    { path: '/bracket', label: 'Bracket', icon: '🏆' },
    { path: '/profile', label: 'Profile', icon: '👤' },
  ];
</script>

<div class="app-layout">
  <!-- Desktop Sidebar -->
  <nav class="sidebar">
    <div style="padding: 0 8px 20px; border-bottom: 1px solid var(--border); margin-bottom: 16px;">
      <div style="font-family: 'Libre Baskerville', serif; font-size: 16px; color: var(--gold); margin-bottom: 4px;">⚽ World Cup</div>
      <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase;">Pool 2026</div>
    </div>

    {#each navItems as item}
      <a
        href={item.path}
        style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px; margin-bottom: 2px; font-size: 12px; color: {currentPath === item.path ? 'var(--gold)' : 'var(--text-muted)'}; background: {currentPath === item.path ? 'rgba(201,168,76,0.08)' : 'transparent'};"
      >
        <span>{item.icon}</span>
        {item.label}
      </a>
    {/each}

    {#if data?.user?.is_admin}
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
        <div style="font-size: 8px; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; padding: 0 12px 8px;">Admin</div>
        <a href="/admin" style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: var(--text-muted);">
          <span>⚙️</span> Settings
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

  <!-- Main Content -->
  <main class="main-content">
    {@render children()}
  </main>

  <!-- Mobile Bottom Nav -->
  <div class="bottom-nav">
    {#each navItems as item}
      <a href={item.path}>
        <button class:active={currentPath === item.path}>
          <span style="font-size: 18px;">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      </a>
    {/each}
  </div>
</div>
