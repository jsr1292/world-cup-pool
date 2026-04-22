import { writable } from 'svelte/store';

export const headerTitle = writable({ text: 'Mundial 2026', emoji: '🏆', showBack: false, poolName: null, poolEmoji: null });
