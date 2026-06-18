import { vapidPublicKey } from '$lib/server/push.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user || null,
    // Public VAPID key for the client push subscription (null = push disabled).
    vapidPublicKey: vapidPublicKey(),
  };
};
