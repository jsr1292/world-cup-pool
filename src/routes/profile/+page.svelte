<script lang="ts">
  import type { PageData } from './$types.js';
  import { logout } from '$lib/logout.js';
  import { onMount } from 'svelte';
  let { data }: { data: PageData } = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let changing = $state(false);
  let changeResult = $state(null) as { ok: boolean; msg: string } | null;

  // Display-name change (the name shown in each pool's Clasificación)
  let newName = $state('');
  let changingName = $state(false);
  let nameResult = $state(null) as { ok: boolean; msg: string } | null;
  let nameUsed = $state(data.displayNameChangesUsed ?? 0);
  const nameMax = data.displayNameChangesMax ?? 3;
  const nameRemaining = $derived(Math.max(0, nameMax - nameUsed));

  async function changeName() {
    const n = newName.replace(/\s+/g, ' ').trim();
    if (n.length < 1) { nameResult = { ok: false, msg: 'Escribe un nombre' }; return; }
    if (n.length > 50) { nameResult = { ok: false, msg: 'Máximo 50 caracteres' }; return; }
    if (n === data.user.display_name) { nameResult = { ok: false, msg: 'Ese ya es tu nombre' }; return; }
    changingName = true;
    nameResult = null;
    try {
      const res = await fetch('/api/auth/change-display-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: n }),
      });
      const d = await res.json();
      if (d.ok) {
        nameResult = { ok: true, msg: `Nombre actualizado a ${d.display_name}` };
        nameUsed = nameMax - (d.remaining ?? 0);
        newName = '';
        // Reload so the new name shows everywhere (sidebar, leaderboards).
        setTimeout(() => window.location.reload(), 900);
      } else {
        nameResult = { ok: false, msg: d.error || 'Error' };
      }
    } catch {
      nameResult = { ok: false, msg: 'Error de conexión' };
    }
    changingName = false;
  }

  let isDark = $state(false);
  $effect(() => {
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  });

  function toggleTheme() {
    isDark = !isDark;
    const theme = isDark ? '' : 'light';
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
    // Update body background and theme-color meta
    document.body.style.background = isDark ? '#07090f' : '#f5f5f0';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = isDark ? '#07090f' : '#f5f5f0';
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      changeResult = { ok: false, msg: 'Las contraseñas no coinciden' };
      return;
    }
    if (newPassword.length < 4) {
      changeResult = { ok: false, msg: 'Mínimo 4 caracteres' };
      return;
    }
    changing = true;
    changeResult = null;
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const d = await res.json();
      if (d.ok) {
        changeResult = { ok: true, msg: 'Contraseña actualizada' };
        currentPassword = '';
        newPassword = '';
        confirmPassword = '';
      } else {
        changeResult = { ok: false, msg: d.error || 'Error' };
      }
    } catch {
      changeResult = { ok: false, msg: 'Error de conexión' };
    }
    changing = false;
  }

  // ── Push notifications ──────────────────────────────────────────────────────
  const vapidKey = ((data as any).vapidPublicKey ?? null) as string | null;
  let pushSupported = $state(false);
  let pushEnabled = $state(false);
  let pushBusy = $state(false);
  let pushMsg = $state('');
  let iosNeedsInstall = $state(false);

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  onMount(async () => {
    pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const ua = navigator.userAgent || '';
    const iOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    iosNeedsInstall = iOS && !standalone;
    if (!pushSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      pushEnabled = !!(await reg.pushManager.getSubscription());
    } catch { /* ignore */ }
  });

  async function enablePush() {
    pushBusy = true; pushMsg = '';
    try {
      if (!vapidKey) { pushMsg = 'El servidor aún no tiene las notificaciones configuradas.'; return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { pushMsg = 'Permiso de notificaciones denegado.'; return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource }));
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      if (!res.ok) throw new Error('save failed');
      pushEnabled = true;
      pushMsg = '✓ Notificaciones activadas.';
    } catch {
      pushMsg = 'No se pudieron activar las notificaciones.';
    } finally {
      pushBusy = false;
    }
  }

  async function disablePush() {
    pushBusy = true; pushMsg = '';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      pushEnabled = false;
      pushMsg = 'Notificaciones desactivadas.';
    } catch {
      pushMsg = 'No se pudieron desactivar.';
    } finally {
      pushBusy = false;
    }
  }

  async function testPush() {
    pushBusy = true; pushMsg = '';
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      pushMsg = res.ok ? (d.sent > 0 ? '✓ Enviada — mira tus notificaciones.' : 'No hay dispositivos suscritos.') : (d.error || 'Error');
    } catch {
      pushMsg = 'Error de conexión.';
    } finally {
      pushBusy = false;
    }
  }
</script>

<div>
  <h1 style="font-family: 'Libre Baskerville', serif; font-size: 20px; color: var(--gold); margin-bottom: 4px;">Perfil</h1>
  <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 24px;">Ajustes de cuenta</p>

  <!-- User Info -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Email</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.email || data.user.username}</div>
      </div>
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Nombre</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.display_name}</div>
      </div>
      <div>
        <div style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px;">Miembro desde</div>
        <div style="font-size: 13px; color: var(--text);">{data.user.created_at ? new Date(data.user.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</div>
      </div>
    </div>
  </div>

  <!-- Change display name -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 6px;">🪪 Nombre</div>
    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5;">
      Tu nombre actual es <strong style="color: var(--gold);">{data.user.display_name}</strong>. Es el que ven los demás en la clasificación de cada quiniela (tu correo nunca se muestra).
    </p>

    {#if nameRemaining > 0}
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Nuevo nombre</label>
          <input bind:value={newName} placeholder="Tu nombre" autocomplete="name" maxlength="50"
            onkeydown={(e) => { if (e.key === 'Enter') changeName(); }} />
          <div style="font-size: 9px; color: var(--text-dim); margin-top: 5px;">Hasta 50 caracteres. Te quedan <strong>{nameRemaining}</strong> de {nameMax} cambios.</div>
        </div>

        {#if nameResult}
          <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: {nameResult.ok ? 'rgba(0,229,160,0.1)' : 'rgba(255,77,106,0.1)'}; color: {nameResult.ok ? 'var(--green)' : 'var(--red)'};">
            {nameResult.msg}
          </div>
        {/if}

        <button class="btn-primary" onclick={changeName} disabled={changingName || !newName.trim()}>
          {changingName ? 'Guardando...' : 'Cambiar nombre'}
        </button>
      </div>
    {:else}
      <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-muted);">
        Has usado tus {nameMax} cambios de nombre. No se pueden hacer más.
      </div>
    {/if}
  </div>

  <!-- Appearance -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 16px;">🎨 Apariencia</div>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 12px; color: var(--text);">Tema oscuro</span>
      <button onclick={toggleTheme} style="width: 44px; height: 24px; border-radius: 12px; border: none; cursor: pointer; position: relative; transition: background 0.2s; background: {isDark ? 'var(--gold)' : 'var(--border)'};">
        <span style="position: absolute; top: 2px; {isDark ? 'right: 2px;' : 'left: 2px;'} width: 20px; height: 20px; border-radius: 50%; background: white; transition: all 0.2s;"></span>
      </button>
    </div>
  </div>

  <!-- Notifications -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 6px;">🔔 Notificaciones</div>
    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5;">
      Recibe un aviso en el móvil cuando haya <strong>nuevos resultados</strong> y cambie la clasificación.
    </p>
    {#if !vapidKey}
      <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-muted);">No disponibles por ahora.</div>
    {:else if iosNeedsInstall}
      <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: rgba(201,168,76,0.08); color: var(--text-muted); line-height: 1.5;">
        En iPhone, primero <strong>añade la app a la pantalla de inicio</strong> (Compartir → «Añadir a pantalla de inicio») y ábrela desde ahí para poder activar las notificaciones.
      </div>
    {:else if !pushSupported}
      <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-muted);">Tu navegador no soporta notificaciones.</div>
    {:else}
      <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
        {#if pushEnabled}
          <span style="font-size: 11px; color: var(--green); font-weight: 600;">✓ Activadas</span>
          <button class="btn-ghost" style="font-size: 10px; padding: 7px 14px;" onclick={testPush} disabled={pushBusy}>Enviar prueba</button>
          <button class="btn-ghost" style="font-size: 10px; padding: 7px 14px;" onclick={disablePush} disabled={pushBusy}>Desactivar</button>
        {:else}
          <button class="btn-primary" style="font-size: 11px;" onclick={enablePush} disabled={pushBusy}>{pushBusy ? 'Activando…' : 'Activar notificaciones'}</button>
        {/if}
      </div>
      {#if pushMsg}
        <div style="font-size: 10px; margin-top: 10px; color: {pushMsg.startsWith('✓') ? 'var(--green)' : 'var(--text-muted)'};">{pushMsg}</div>
      {/if}
    {/if}
  </div>

  <!-- Change Password -->
  <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 16px;">🔐 Cambiar contraseña</div>

    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Contraseña actual</label>
        <input type="password" bind:value={currentPassword} placeholder="••••••••" />
      </div>
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Nueva contraseña</label>
        <input type="password" bind:value={newPassword} placeholder="••••••••" />
      </div>
      <div>
        <label style="font-size: 9px; color: var(--text-muted); letter-spacing: 0.12em; text-transform: uppercase; display: block; margin-bottom: 4px;">Confirmar contraseña</label>
        <input type="password" bind:value={confirmPassword} placeholder="••••••••" />
      </div>

      {#if changeResult}
        <div style="font-size: 11px; padding: 8px 12px; border-radius: 6px; background: {changeResult.ok ? 'rgba(0,229,160,0.1)' : 'rgba(255,77,106,0.1)'}; color: {changeResult.ok ? 'var(--green)' : 'var(--red)'};">
          {changeResult.msg}
        </div>
      {/if}

      <button class="btn-primary" onclick={changePassword} disabled={changing || !currentPassword || !newPassword || !confirmPassword}>
        {changing ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </div>
  </div>

  <!-- Logout -->
  <button type="button" onclick={logout} class="btn-ghost" style="width: 100%;">Cerrar sesión</button>
</div>
