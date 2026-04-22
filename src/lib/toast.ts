import { writable } from 'svelte/store';

export const toast = writable('');
let timer: ReturnType<typeof setTimeout>;
export function showToast(msg: string) {
  clearTimeout(timer);
  toast.set(msg);
  timer = setTimeout(() => toast.set(''), 2500);
}
