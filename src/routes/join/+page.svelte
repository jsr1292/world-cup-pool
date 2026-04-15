<script>
  let code = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleJoin(e) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/pools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || 'Error';
      } else {
        window.location.href = `/pool/${data.pool_id}`;
      }
    } catch {
      error = 'Connection error';
    } finally {
      loading = false;
    }
  }
</script>

<div style="max-width: 440px; margin: 0 auto;">
  <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Home</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Join Pool</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Enter the invite code shared by the pool creator</p>

  <form onsubmit={handleJoin} style="display: flex; flex-direction: column; gap: 14px;">
    <div>
      <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5px; letter-spacing: 0.12em; text-transform: uppercase;">Invite Code</label>
      <input bind:value={code} placeholder="AB12CD34" style="text-align: center; font-size: 18px; letter-spacing: 0.15em; text-transform: uppercase;" maxlength="8" required />
    </div>

    {#if error}
      <p style="font-size: 10px; color: var(--red);">{error}</p>
    {/if}

    <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading}>
      {loading ? 'Joining...' : 'Join Pool'}
    </button>
  </form>
</div>
