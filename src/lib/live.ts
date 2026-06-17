import { writable } from 'svelte/store';

// Set of OUR match ids currently in play, published by the layout's /api/live
// poller. Group matches are never marked "live" in the DB (the sync only writes
// finished results), so pages read live state from here instead of match.status.
export const liveMatchIds = writable<Set<number>>(new Set());
