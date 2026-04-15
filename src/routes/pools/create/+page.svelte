<script>
  let name = $state('');
  let buyIn = $state('0');
  let error = $state('');
  let loading = $state(false);

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, buy_in: parseFloat(buyIn) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || 'Error';
      } else {
        window.location.href = `/pool/${data.id}`;
      }
    } catch {
      error = 'Connection error';
    } finally {
      loading = false;
    }
  }
</script>

<div style="max-width: 440px; margin: 0 auto;">
  <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Back</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Create Pool</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Set up a new prediction pool for your friends</p>

  <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: 14px;">
    <div>
      <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5px; letter-spacing: 0.12em; text-transform: uppercase;">Pool Name *</label>
      <input bind:value={name} placeholder="e.g. Oficina Pool" required />
    </div>

    <div>
      <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5px; letter-spacing: 0.12em; text-transform: uppercase;">Buy-in (€) — 0 for free</label>
      <input type="number" min="0" step="0.01" bind:value={buyIn} placeholder="10" oninput="if(this.value<0)this.value=0" />
    </div>

    {#if error}
      <p style="font-size: 10px; color: var(--red);">{error}</p>
    {/if}

    <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>
      {loading ? 'Creating...' : 'Create Pool'}
    </button>
  </form>
</div>
