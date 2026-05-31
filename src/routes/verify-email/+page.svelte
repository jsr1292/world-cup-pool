<script>
  let { data } = $props();
</script>

<div style="min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px;">
  <div style="max-width: 360px; text-align: center;">
    <div style="font-size: 40px; margin-bottom: 12px;">⚠️</div>
    <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 8px;">
      Enlace no válido
    </h1>
    <p style="font-size: 12px; color: var(--text-muted); line-height: 1.6; margin-bottom: 20px;">
      Este enlace de verificación es incorrecto o ha caducado (validez 24 horas).
      Intenta iniciar sesión de nuevo: te enviaremos un enlace nuevo automáticamente.
    </p>
    <a href="/login" class="btn-primary" style="display: inline-block; font-size: 11px; padding: 10px 24px;">Ir a iniciar sesión</a>
  </div>
</div>
