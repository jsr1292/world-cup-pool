<script>
  import { haptic } from '$lib/haptic';
  let name = $state('');
  let buyIn = $state('0');
  let allowMultiple = $state(false);
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
        body: JSON.stringify({ name, buy_in: parseFloat(buyIn) || 0, allow_multiple_predictions: allowMultiple }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || 'Error';
      } else {
        window.location.href = `/pool/${data.id}`;
      }
    } catch {
      error = 'Error de conexión';
    } finally {
      loading = false;
    }
  }
</script>

<div style="max-width: 440px; margin: 0 auto;">
  <a href="/" style="font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">← Inicio</a>

  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Crear Quiniela</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Configura una nueva quiniela para tus amigos</p>

  <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: 14px;">
    <div>
      <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5px; letter-spacing: 0.12em; text-transform: uppercase;">Nombre *</label>
      <input bind:value={name} placeholder="Ej: Quiniela Oficina" required />
    </div>

    <div>
      <label style="display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 5px; letter-spacing: 0.12em; text-transform: uppercase;">Cuota de entrada (€) — 0 para gratis</label>
      <input inputmode="decimal" min="0" step="0.01" bind:value={buyIn} placeholder="10" oninput={(e) => { if (Number(e.target.value) < 0) buyIn = '0'; }} />
    </div>

    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px;">
      <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
        <input type="checkbox" bind:checked={allowMultiple} style="margin-top: 2px; width: 14px; height: 14px; accent-color: var(--gold);" />
        <div>
          <div style="font-size: 11px; color: var(--text); font-weight: 500;">Múltiples apuestas por usuario</div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Permite a cada usuario crear varias entradas con diferentes predicciones en la misma quiniela.</div>
        </div>
      </label>
    </div>

    {#if error}
      <p style="font-size: 10px; color: var(--red);">{error}</p>
    {/if}

    <button type="submit" class="btn-primary" style="width: 100%;" disabled={loading} onclick={() => haptic(10)}>
      {loading ? 'Creando...' : 'Crear Quiniela'}
    </button>
  </form>
</div>
