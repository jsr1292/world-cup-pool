<script>
  import { onMount } from 'svelte';

  // Encourages installing the app to the home screen.
  // - Android/desktop Chromium: capture beforeinstallprompt → "Instalar" button
  //   that fires the real native prompt.
  // - iOS Safari: no programmatic prompt exists, so show a short how-to hint.
  // Dismissals are remembered (and not shown again for a while).

  const KEY = 'pwa-install-dismissed';
  const REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  let show = $state(false);
  /** @type {'android' | 'ios' | null} */
  let mode = $state(null);
  /** @type {any} */
  let deferred = null;

  function isInstalled() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
    } catch { return false; }
  }
  function recentlyDismissed() {
    try { const v = localStorage.getItem(KEY); return !!v && Date.now() - Number(v) < REMIND_AFTER_MS; }
    catch { return false; }
  }
  function remember() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } }
  function isIOS() {
    const ua = navigator.userAgent || '';
    const iOSDevice = /iphone|ipad|ipod/i.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOS;
  }

  function dismiss() { remember(); show = false; }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    deferred = null;
    show = false;
    remember(); // installed → appinstalled also fires; declined → don't nag again soon
  }

  onMount(() => {
    if (isInstalled() || recentlyDismissed()) return;

    if (isIOS()) {
      const ua = navigator.userAgent || '';
      // Only Safari can "Add to Home Screen"; other iOS browsers can't, so skip.
      if (/safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)) { mode = 'ios'; show = true; }
      return;
    }

    const onBIP = (/** @type {any} */ e) => { e.preventDefault(); deferred = e; mode = 'android'; show = true; };
    const onInstalled = () => { show = false; deferred = null; remember(); };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });
</script>

{#if show}
  <div class="install-prompt" role="dialog" aria-label="Instalar aplicación">
    <img src="/icon-192.png" alt="" width="40" height="40" style="border-radius: 9px; flex-shrink: 0;" />
    <div style="flex: 1; min-width: 0;">
      <div style="font-size: 12px; font-weight: 700; color: var(--gold);">Instala Mundial 2026</div>
      {#if mode === 'ios'}
        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.45; margin-top: 2px;">
          Pulsa <strong>Compartir</strong> <span aria-hidden="true">⬆️</span> y luego <strong>«Añadir a pantalla de inicio»</strong>.
        </div>
      {:else}
        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.45; margin-top: 2px;">
          Ábrela como una app, sin barra del navegador.
        </div>
      {/if}
    </div>
    {#if mode === 'android'}
      <button onclick={install} class="install-btn">Instalar</button>
    {/if}
    <button onclick={dismiss} aria-label="Cerrar" class="install-close">✕</button>
  </div>
{/if}

<style>
  .install-prompt {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
    width: min(440px, calc(100vw - 24px));
    z-index: 1200;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-card, #12151f);
    border: 1px solid rgba(201, 168, 76, 0.35);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  }
  /* On desktop (sidebar layout, no bottom nav) sit near the corner. */
  @media (min-width: 768px) {
    .install-prompt { left: auto; right: 16px; transform: none; bottom: 16px; }
  }
  .install-btn {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: #1a1a2e;
    background: linear-gradient(135deg, #c9a84c, #e8c96a);
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .install-close {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-muted, #888);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
  }
</style>
