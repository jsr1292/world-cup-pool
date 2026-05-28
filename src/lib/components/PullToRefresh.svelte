<script lang="ts">
  let { onRefresh, children }: { onRefresh: () => Promise<void>; children: any } = $props();

  let pullY = $state(0);
  let refreshing = $state(false);
  let startY = 0;
  let pulling = false;

  function onTouchStart(e: TouchEvent) {
    if (refreshing) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) { pulling = false; pullY = 0; return; }
    pullY = Math.min(dy * 0.4, 80);
  }

  async function onTouchEnd() {
    if (!pulling) return;
    pulling = false;
    if (pullY > 50 && !refreshing) {
      refreshing = true;
      pullY = 0;
      try { await onRefresh(); } finally { refreshing = false; }
    } else {
      pullY = 0;
    }
  }
</script>

<div ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd} style="min-height:100%;overflow-y:auto;">
  <!-- Pull indicator -->
  <div style="display:flex;align-items:center;justify-content:center;height:{refreshing ? 44 : pullY}px;opacity:{refreshing || pullY > 10 ? 1 : 0};transition:{pullY === 0 ? 'height 0.3s ease-out,opacity 0.2s' : 'none'};pointer-events:none;">
    {#if refreshing}
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="animation:spin 0.8s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke="rgba(201,168,76,0.2)" stroke-width="2" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
    {:else if pullY > 10}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="transform:rotate({pullY > 50 ? 180 : 0}deg);transition:transform 0.15s;">
        <path d="M12 5v14M5 12l7 7 7-7" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    {/if}
  </div>

  {@render children()}
</div>
