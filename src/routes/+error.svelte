<script lang="ts">
  import { page } from '$app/state';

  // Friendly Spanish copy per status; falls back to the thrown message.
  const messages: Record<number, string> = {
    403: 'No tienes acceso a esta página.',
    404: 'No encontramos lo que buscabas.',
    500: 'Algo salió mal por nuestro lado.',
  };
  const detail = $derived(messages[page.status] ?? page.error?.message ?? 'Se produjo un error inesperado.');
</script>

<div class="error-wrap">
  <div class="error-card">
    <div class="error-emoji">⚽️</div>
    <div class="error-status">{page.status}</div>
    <h1 class="error-title">Fuera de juego</h1>
    <p class="error-detail">{detail}</p>
    <a class="error-home" href="/">Volver al inicio</a>
  </div>
</div>

<style>
  .error-wrap {
    min-height: 70vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .error-card {
    text-align: center;
    max-width: 360px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 36px 28px;
  }
  .error-emoji {
    font-size: 44px;
    margin-bottom: 8px;
  }
  .error-status {
    font-family: 'Libre Baskerville', serif;
    font-size: 40px;
    color: var(--gold);
    line-height: 1;
  }
  .error-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--text);
    margin: 12px 0 6px;
  }
  .error-detail {
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 24px;
    line-height: 1.5;
  }
  .error-home {
    display: inline-block;
    font-size: 13px;
    font-weight: 600;
    color: var(--gold);
    text-decoration: none;
    padding: 9px 20px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .error-home:hover {
    border-color: var(--border-hover);
  }
</style>
