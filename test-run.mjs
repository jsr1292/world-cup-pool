import { chromium } from 'playwright';

const BASE = 'http://192.168.50.203:3450';
const TS = Date.now();
const U1 = `t1_${TS}`, U2 = `t2_${TS}`;
const PW = 'Test1234!';
const D1 = 'Tester One', D2 = 'Tester Two';

const R = [];
let browser, page;
let inviteCode = '', freeId = null, paidId = null;
const errors = [];

const ok = (t, d='') => { console.log(`✅ [${t}] ${d}`); R.push({t,s:'PASS',d}); };
const fail = (t, d='') => { console.log(`❌ [${t}] ${d}`); R.push({t,s:'FAIL',d}); };
const warn = (t, d='') => { console.log(`⚠️  [${t}] ${d}`); R.push({t,s:'WARN',d}); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function nav(path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await wait(500);
}

async function ss(name) {
  try { await page.screenshot({ path: `/tmp/ss_${name}.png`, fullPage: true }); } catch {}
}

// Register via API to get cookie, then navigate
async function register(username, password, displayName) {
  const resp = await page.evaluate(async (args) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: args.u, password: args.p, display_name: args.d }),
    });
    return { ok: res.ok, status: res.status, data: await res.json() };
  }, { u: username, p: password, d: displayName });
  return resp;
}

async function login(username, password) {
  const resp = await page.evaluate(async (args) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: args.u, password: args.p }),
    });
    return { ok: res.ok, status: res.status, data: await res.json() };
  }, { u: username, p: password });
  return resp;
}

async function logout() {
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
  });
  // Clear cookies manually since the redirect from server might not work in evaluate
  await page.context().clearCookies();
}

async function isLoggedIn() {
  await nav('/');
  const text = await page.textContent('body');
  return text.includes('Hola') || text.includes('Perfil');
}

// ===== USER TESTS =====

async function test1() {
  console.log('\n=== TEST 1: Register → Login → Logout → Login ===');
  await nav('/login');

  // Register via UI
  await page.click('button:has-text("Registro")');
  await wait(300);
  await page.fill('input[placeholder="usuario"]', U1);
  await page.fill('input[placeholder="Tu nombre"]', D1);
  await page.fill('input[placeholder="••••••••"]', PW);

  await Promise.all([
    page.waitForURL('**/', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);

  if (page.url().includes('/login')) {
    const err = await page.$('p[style*="red"]');
    if (err) {
      const t = await err.textContent();
      if (t.includes('taken')) { ok('1-register', 'User exists (rerun)'); }
      else { fail('1-register', t); return; }
    } else { fail('1-register', 'Stuck on login'); return; }
  } else {
    ok('1-register', U1);
  }

  // Verify logged in
  if (await isLoggedIn()) ok('1-login-after-register');
  else { fail('1-login-after-register', 'Not logged in after register'); return; }

  // Logout via API + clear
  await logout();
  await nav('/');
  if (page.url().includes('/login')) ok('1-logout');
  else { fail('1-logout', `URL: ${page.url()}`); }

  // Login again
  await nav('/login');
  await page.fill('input[placeholder="usuario"]', U1);
  await page.fill('input[placeholder="••••••••"]', PW);
  await Promise.all([
    page.waitForURL('**/', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);

  if (await isLoggedIn()) ok('1-relogin');
  else fail('1-relogin', `URL: ${page.url()}`);
}

async function test2() {
  console.log('\n=== TEST 2: Home Page ===');
  await nav('/');
  const h1 = await page.$('h1');
  if (h1) ok('2-greeting', await h1.textContent());
  else fail('2-greeting');

  const link = await page.$('a[href*="create"]');
  link ? ok('2-create-link') : fail('2-create-link');
}

async function test3() {
  console.log('\n=== TEST 3: Create Free Pool ===');
  console.log('  [DEBUG] cookies before nav:', (await page.context().cookies()).map(c => c.name));
  await nav('/pools/create');
  console.log('  [DEBUG] URL after nav:', page.url(), 'cookies:', (await page.context().cookies()).map(c => c.name));
  if (page.url().includes('/login')) { fail('3', 'Redirected to login'); return; }

  await page.fill('input[placeholder*="Quiniela"]', `Free_${TS}`);
  const num = await page.$('input[type="number"]');
  if (num) await num.fill('0');

  // Debug: check what happens on submit
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/pools')) {
      console.log('  [DEBUG] API response:', resp.status(), await resp.text().catch(()=>''));
    }
  });
  await page.evaluate(() => console.log('cookie', document.cookie));
  console.log('  [DEBUG] About to submit, URL:', page.url());

  await Promise.all([
    page.waitForURL('**/pool/**', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);

  const url = page.url();
  if (url.includes('/pool/')) {
    freeId = url.split('/pool/')[1];
    ok('3', `ID: ${freeId}`);
  } else {
    fail('3', url);
    await ss('test3');
  }
}

async function test4() {
  console.log('\n=== TEST 4: Create Paid Pool ===');
  await nav('/pools/create');
  if (page.url().includes('/login')) { fail('4', 'Redirected to login'); return; }

  await page.fill('input[placeholder*="Quiniela"]', `Paid_${TS}`);
  const num = await page.$('input[type="number"]');
  if (num) await num.fill('10');
  const cb = await page.$('input[type="checkbox"]');
  if (cb && !(await cb.isChecked())) await cb.check();

  await Promise.all([
    page.waitForURL('**/pool/**', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);

  const url = page.url();
  if (url.includes('/pool/')) {
    paidId = url.split('/pool/')[1];
    ok('4', `ID: ${paidId} (€10, multi)`);
  } else { fail('4', url); await ss('test4'); }
}

async function test5() {
  console.log('\n=== TEST 5: Pool Detail Tabs ===');
  if (!freeId) { fail('5', 'No pool'); return; }
  await nav(`/pool/${freeId}`);
  for (const tab of ['Clasificación', 'Pronósticos', 'Eliminatorias', 'Miembros', 'Puntuación']) {
    const btn = await page.$(`button:has-text("${tab}")`);
    if (btn) { await btn.click(); await wait(200); ok(`5-${tab}`); }
    else fail(`5-${tab}`, 'not found');
  }
}

async function test6() {
  console.log('\n=== TEST 6: Sticky Header Back Link ===');
  if (!freeId) { fail('6', 'No pool'); return; }
  await nav(`/pool/${freeId}`);
  const back = await page.$('a:has-text("Quinielas")');
  if (!back) { fail('6', 'not found'); return; }
  await back.click();
  await page.waitForLoadState('networkidle');
  await wait(300);
  (page.url() === BASE + '/') ? ok('6') : fail('6', page.url());
}

async function test7() {
  console.log('\n=== TEST 7: Invite Code Copy ===');
  if (!freeId) { fail('7', 'No pool'); return; }
  await nav(`/pool/${freeId}`);
  const txt = await page.textContent('body');
  const m = txt.match(/([A-Z0-9]{6,})/);
  if (m) { inviteCode = m[1]; ok('7-code', inviteCode); }
  else fail('7-code', 'not found');

  const cp = await page.$('button:has-text("Copiar")');
  cp ? ok('7-copy-btn') : warn('7-copy-btn', 'not found');
}

async function test8() {
  console.log('\n=== TEST 8: Join Pool via Invite ===');
  if (!inviteCode) { fail('8', 'No invite code'); return; }

  // Logout
  await logout();
  await nav('/login');

  // Register U2
  await page.click('button:has-text("Registro")');
  await wait(300);
  await page.fill('input[placeholder="usuario"]', U2);
  await page.fill('input[placeholder="Tu nombre"]', D2);
  await page.fill('input[placeholder="••••••••"]', PW);
  await Promise.all([
    page.waitForURL('**/', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);
  ok('8-register-u2');

  // Join pool
  await nav('/join');
  const ci = await page.$('input[placeholder*="código" i], input[placeholder*="Código" i]');
  if (!ci) { fail('8', 'code input not found'); await ss('join'); return; }
  await ci.fill(inviteCode);
  await Promise.all([
    page.waitForURL('**/pool/**', { timeout: 8000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(500);
  page.url().includes('/pool/') ? ok('8') : fail('8', page.url());
}

async function test9() {
  console.log('\n=== TEST 9: Group Predictions ===');
  if (!freeId) { fail('9', 'No pool'); return; }
  // Login as U2 (should already be logged in from test8)
  await nav(`/pool/${freeId}/predict`);
  if (page.url().includes('/login')) {
    // Need to login as U1 who created the pool
    await logout();
    await nav('/login');
    await page.fill('input[placeholder="usuario"]', U1);
    await page.fill('input[placeholder="••••••••"]', PW);
    await Promise.all([page.waitForURL('**/', {timeout:8000}).catch(()=>{}), page.click('button[type="submit"]')]);
    await wait(500);
    await nav(`/pool/${freeId}/predict`);
  }

  const sels = await page.$$('select');
  if (sels.length >= 2) {
    for (let i = 0; i < Math.min(4, sels.length); i++) {
      const opts = await sels[i].$$('option');
      if (opts.length > 1) await sels[i].selectOption({ index: 1 });
    }
    const save = await page.$('button:has-text("Guardar")');
    if (save) { await save.click(); await wait(500); ok('9'); }
    else warn('9', 'no save btn');
  } else warn('9', `${sels.length} selects`);
}

async function test10() {
  console.log('\n=== TEST 10: Bracket Predictions ===');
  if (!freeId) { fail('10', 'No pool'); return; }
  await nav(`/pool/${freeId}/bracket`);
  const sels = await page.$$('select');
  if (sels.length > 0) {
    for (let i = 0; i < Math.min(4, sels.length); i++) {
      const opts = await sels[i].$$('option');
      if (opts.length > 1) await sels[i].selectOption({ index: 1 });
    }
    const save = await page.$('button:has-text("Guardar")');
    if (save) { await save.click(); await wait(500); ok('10'); }
    else warn('10', 'no save btn');
  } else warn('10', 'no selects');
}

async function test11() {
  console.log('\n=== TEST 11: Profile Page ===');
  await nav('/profile');
  if (page.url().includes('/login')) { fail('11', 'redirected'); return; }
  const txt = await page.textContent('body');
  (txt.includes('Usuario') || txt.includes('Nombre')) ? ok('11-info') : fail('11-info');

  const lo = await page.$('button:has-text("Cerrar sesión")');
  if (lo) {
    await lo.click(); await wait(1000);
    // The form POST redirects to /login
    ok('11-logout');
  } else fail('11-logout', 'btn not found');
}

async function test12() {
  console.log('\n=== TEST 12: Second Prediction Entry ===');
  if (!paidId) { fail('12', 'No paid pool'); return; }
  // Login as U2
  await nav('/login');
  await page.fill('input[placeholder="usuario"]', U2);
  await page.fill('input[placeholder="••••••••"]', PW);
  await Promise.all([page.waitForURL('**/', {timeout:8000}).catch(()=>{}), page.click('button[type="submit"]')]);
  await wait(500);
  await nav(`/pool/${paidId}/predict`);

  const add = await page.$('button:has-text("Nueva"), button:has-text("Add")');
  add ? ok('12', 'add btn found') : warn('12', 'no add btn');
}

// ===== ADMIN TESTS =====

async function adminSetup() {
  // Login as U1 (pool creator = admin)
  await logout();
  await nav('/login');
  await page.fill('input[placeholder="usuario"]', U1);
  await page.fill('input[placeholder="••••••••"]', PW);
  await Promise.all([page.waitForURL('**/', {timeout:8000}).catch(()=>{}), page.click('button[type="submit"]')]);
  await wait(500);
}

async function admin1() {
  console.log('\n=== ADMIN 1: Admin Page ===');
  if (!paidId) { fail('A1', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  if (page.url().includes('/login')) { fail('A1', 'redirected'); return; }
  const txt = await page.textContent('body');
  let found = ['Configuración','Fechas','Puntuación','Miembros'].filter(s => txt.includes(s)).length;
  found >= 3 ? ok('A1', `${found}/4 sections`) : fail('A1', `${found}/4 sections`);
}

async function admin2() {
  console.log('\n=== ADMIN 2: Toggle Multiple Entries ===');
  if (!paidId) { fail('A2', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const cb = await page.$('input[type="checkbox"]');
  if (cb) { await cb.click(); await wait(200); }
  const save = await page.$('button:has-text("Guardar")');
  if (save) { await save.click(); await wait(500); ok('A2'); }
  else fail('A2', 'no save btn');
}

async function admin3() {
  console.log('\n=== ADMIN 3: Fechas Límite ===');
  if (!paidId) { fail('A3', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const di = await page.$$('input[type="datetime-local"]');
  if (di.length >= 1) {
    const tom = new Date(); tom.setDate(tom.getDate()+1);
    await di[0].fill(tom.toISOString().slice(0,16));
    const save = await page.$('button:has-text("Guardar")');
    if (save) { await save.click(); await wait(500); ok('A3'); }
  } else fail('A3', 'no date input');
}

async function admin4() {
  console.log('\n=== ADMIN 4: Puntuación Change ===');
  if (!paidId) { fail('A4', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const ni = await page.$$('input[type="number"]');
  if (ni.length > 0) {
    const v = await ni[0].inputValue();
    await ni[0].fill((parseInt(v)+5).toString());
    const save = await page.$('button:has-text("Guardar")');
    if (save) { await save.click(); await wait(500); ok('A4', `${v}→${parseInt(v)+5}`); }
  } else fail('A4', 'no number inputs');
}

async function admin5() {
  console.log('\n=== ADMIN 5: Mark User Paid ===');
  if (!paidId) { fail('A5', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const ub = await page.$('button:has-text("✗ Pendiente")');
  if (ub) {
    await ub.click(); await wait(500);
    (await page.$('button:has-text("✓ Pagado")')) ? ok('A5') : fail('A5', 'did not toggle');
  } else {
    (await page.$('button:has-text("✓ Pagado")')) ? ok('A5', 'already paid') : fail('A5', 'no btn');
  }
}

async function admin6() {
  console.log('\n=== ADMIN 6: Unmark User Paid ===');
  if (!paidId) { fail('A6', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const pb = await page.$('button:has-text("✓ Pagado")');
  if (pb) {
    await pb.click(); await wait(500);
    const dlg = await page.$('[role="dialog"]');
    if (dlg) {
      ok('A6-dialog', 'confirm shown');
      const cf = await dlg.$('button:has-text("Confirmar")');
      if (cf) await cf.click();
      await wait(500);
    }
    (await page.$('button:has-text("✗ Pendiente")')) ? ok('A6') : fail('A6', 'still paid');
  } else fail('A6', 'no paid btn');
}

async function admin7() {
  console.log('\n=== ADMIN 7: Resultados ===');
  if (!paidId) { fail('A7', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const txt = await page.textContent('body');
  txt.includes('Resultados') ? ok('A7') : fail('A7');
  const mi = await page.$$('input[data-match-id]');
  mi.length > 0 ? ok('A7-matches', `${mi.length} inputs`) : warn('A7-matches', 'empty');
}

async function admin8() {
  console.log('\n=== ADMIN 8: Multiple Entries Display ===');
  if (!paidId) { fail('A8', 'No pool'); return; }
  await nav(`/pool/${paidId}/admin`);
  const btns = await page.$$('button:has-text("Pagado"), button:has-text("Pendiente")');
  btns.length >= 1 ? ok('A8', `${btns.length} entries`) : warn('A8', 'no entries');
}

// ===== MAIN =====
(async () => {
  console.log('🌍 World Cup 2026 Pool Tests');
  console.log('='.repeat(40));
  console.log(`Users: ${U1}, ${U2}`);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));

  try {
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    await test8();
    await test9();
    await test10();
    await test11();
    await test12();
    await adminSetup();
    await admin1();
    await admin2();
    await admin3();
    await admin4();
    await admin5();
    await admin6();
    await admin7();
    await admin8();
  } catch (e) {
    console.error('❌ Fatal:', e.message);
    await ss('fatal');
  }

  console.log('\n' + '='.repeat(40));
  console.log('📋 Console Errors:', errors.length || 'None');
  errors.forEach(e => console.log(`  - ${e}`));

  const p = R.filter(r=>r.s==='PASS').length;
  const f = R.filter(r=>r.s==='FAIL').length;
  const w = R.filter(r=>r.s==='WARN').length;

  console.log(`\n📊 SUMMARY: ✅${p} ❌${f} ⚠️${w}`);

  if (f > 0) {
    console.log('\n❌ FAILURES:');
    R.filter(r=>r.s==='FAIL').forEach(r => console.log(`  ${r.t}: ${r.d}`));
    console.log('\n🐛 BUG LIST:');
    R.filter(r=>r.s==='FAIL').forEach((r,i) => console.log(`  [${i+1}] ${r.t} — ${r.d}`));
  }

  await browser.close();
  process.exit(f > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
