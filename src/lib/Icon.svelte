<script>
  // Cohesive line-icon set (24×24, currentColor stroke) replacing the emojis.
  // Pass a `name`; inherits color via currentColor so it tints gold/muted to match.
  /** @type {{ name: string, size?: number, stroke?: number }} */
  let { name, size = 20, stroke = 1.7 } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'trophy'}
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  {:else if name === 'table'}
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M11 3v18" />
  {:else if name === 'ball'}
    <circle cx="12" cy="12" r="9" />
    <path d="m12 7.4 3.7 2.7-1.4 4.3H9.7L8.3 10.1 12 7.4Z" />
    <path d="M12 7.4V3.1" />
    <path d="m15.7 10.1 4.1-1.3" />
    <path d="m14.3 14.4 2.6 3.4" />
    <path d="m9.7 14.4-2.6 3.4" />
    <path d="m8.3 10.1-4.1-1.3" />
  {:else if name === 'sparkles'}
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    <path d="M19 3v4" />
    <path d="M17 5h4" />
  {:else if name === 'chart'}
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="m19 9-5 5-3-3-4 4" />
    <path d="M19 9h-3" />
    <path d="M19 9v3" />
  {:else if name === 'scale'}
    <path d="M12 3v18" />
    <path d="M7 21h10" />
    <path d="M4.5 7.5c2.5 0 5-.8 7.5-2 2.5 1.2 5 2 7.5 2" />
    <path d="m16 7.5 3 7c-.9.7-1.9 1-3 1s-2.1-.3-3-1l3-7Z" />
    <path d="m5 7.5 3 7c-.9.7-1.9 1-3 1s-2.1-.3-3-1l3-7Z" />
  {:else if name === 'route'}
    <circle cx="6.5" cy="18.5" r="2.5" />
    <circle cx="17.5" cy="5.5" r="2.5" />
    <path d="M9 18.5h7a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7" />
  {:else if name === 'users'}
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  {:else if name === 'cpu'}
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z" />
  {:else if name === 'menu'}
    <path d="M4 6h16M4 12h16M4 18h16" />
  {:else if name === 'close'}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === 'crown'}
    <path d="M3 7l4.5 4L12 5l4.5 6L21 7l-1.8 11H4.8L3 7Z" />
    <path d="M4.5 21h15" />
  {:else if name === 'flame'}
    <path d="M12 3c1 3.5 4 4.5 4 8a4 4 0 0 1-8 0c0-1.4.6-2.3 1.2-3 .3 1 .9 1.4 1.4 1.6C10 7.5 11 5.7 12 3Z" />
  {:else if name === 'target'}
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  {:else if name === 'arrow-up'}
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  {:else if name === 'moon'}
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  {:else if name === 'swords'}
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
    <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
    <path d="M14.5 6.5 18 3h3v3l-3.5 3.5" />
    <path d="m5 14 6 6M9 18l-4 4M5 21l-2-2" />
  {:else if name === 'rotate'}
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  {:else if name === 'calendar'}
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  {:else if name === 'hash'}
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  {:else if name === 'clipboard'}
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  {:else if name === 'medal'}
    <path d="M7.5 2 12 8.5 16.5 2" />
    <path d="M9 2h6" />
    <circle cx="12" cy="15" r="6" />
    <path d="m12 12 1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L10 14.3l2-.3 1-2Z" />
  {:else if name === 'filter'}
    <path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" />
  {:else if name === 'home'}
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  {:else if name === 'user'}
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  {:else if name === 'settings'}
    <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7V20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  {/if}
</svg>

<style>
  .icon {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>
