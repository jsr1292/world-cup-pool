<script>
  import { onMount } from 'svelte';
  let { data } = $props();
  let error = $state('');
  let loading = $state(false);
  let joined = $state(false);

  async function handleJoin(e) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      });
      const result = await res.json();
      if (!res.ok) {
        error = result.error || 'Error';
      } else {
        joined = true;
        window.location.href = `/pool/${result.pool_id}`;
      }
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
    }
  }

  // Auto-join on load — runs once after hydration, avoiding SSR double-submit
  onMount(() => {
    if (!data.code) return;
    error = '';
    loading = true;
    fetch('/api/pools/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code }),
    })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) {
          error = result.error || 'Error';
        } else {
          joined = true;
          window.location.href = `/pool/${result.pool_id}`;
        }
      })
      .catch(() => {
        error = 'Error de conexión';
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

<div style="max-width: 440px; margin: 0 auto;">
  <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Inicio</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Uniéndose a Quiniela...</h1>

  {#if loading}
    <p style="font-size: 11px; color: var(--text-muted);">Código: <span style="color: var(--gold);">{data.code}</span></p>
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 12px;">Uniéndose automáticamente...</p>
  {:else if error}
    <p style="font-size: 11px; color: var(--red); margin-top: 8px;">{error}</p>
    <a href="/join" style="font-size: 10px; color: var(--gold); margin-top: 12px; display: inline-block;">Introducir código manualmente</a>
  {:else}
    <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">Redirigiendo...</p>
  {/if}
</div>
