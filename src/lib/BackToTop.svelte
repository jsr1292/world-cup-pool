<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from '$lib/Icon.svelte';

  // Floating "back to top" button — the glowing gold circle, parked above the
  // bottom tab bar. Appears once you've scrolled past a screenful, so it's only
  // there when a long list (e.g. the leaderboard / calendar) actually needs it.
  let show = $state(false);

  onMount(() => {
    const onScroll = () => {
      show = window.scrollY > 500;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  function toTop() {
    try {
      navigator.vibrate?.(5);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if show}
  <button type="button" class="to-top" onclick={toTop} aria-label="Volver arriba" transition:fade={{ duration: 160 }}>
    <Icon name="arrow-up" size={22} stroke={2.1} />
  </button>
{/if}

<style>
  .to-top {
    position: fixed;
    right: 16px;
    /* Above the phone tab bar (≈58px + safe area). */
    bottom: calc(74px + env(safe-area-inset-bottom, 0px));
    z-index: 95;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    color: #1a1a2e;
    background: linear-gradient(135deg, #e8c96a, #c9a84c);
    border: none;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(201, 168, 76, 0.4);
    cursor: pointer;
    transition: transform 0.12s ease, bottom 0.28s ease;
  }
  .to-top:active {
    transform: scale(0.92);
  }

  /* When the nav auto-hides on scroll-down the tab bar is gone too, so drop the
     button into the reclaimed corner space (matches the bars' glide).
     Phones only — desktop has no bottom bar. */
  @media (max-width: 767px) {
    :global(html.nav-collapsed) .to-top {
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    }
  }

  /* No bottom tab bar on wider screens — sit at the normal corner offset. */
  @media (min-width: 768px) {
    .to-top {
      bottom: 24px;
    }
  }
</style>
