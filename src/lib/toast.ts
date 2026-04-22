import { writable } from 'svelte/store';

export const toast = writable('');
export function showToast(msg: string) {
  toast.set(msg);
  setTimeout(() => toast.set(''), 2500);
}
