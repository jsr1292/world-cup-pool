<script>
  import { onMount } from 'svelte';
  let { data } = $props();
  let error = $state('');
  let loading = $state(false);
  let joined = $state(false);
  // §4.5 — Single-flight guard so a hydration-race click on the manual
  // form does not produce a parallel join, and so a 409 ("already in
  // this pool") is treated as success rather than as an error flash.
  let joinInFlight = false;

  async function performJoin() {
    if (joinInFlight) return;
    joinInFlight = true;
    error = '';
    loading = true;
    try {
      const res = await fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      });
      const result = await res.json();
      if (res.ok) {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
        return;
      }
      // §4.5 — 409 "Ya estás en esta quiniela" means the parallel auto-join
      // succeeded; treat it as success rather than a user-visible error.
      if (res.status === 409 && result.pool_id) {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
        return;
      }
      error = result.error || 'Error';
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
      joinInFlight = false;
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    await performJoin();
  }

  // Auto-join on load — runs once after hydration, avoiding SSR double-submit
  onMount(() => {
    if (!data.code) return;
    performJoin();
  });
</script>
