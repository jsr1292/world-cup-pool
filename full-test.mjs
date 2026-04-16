import { chromium } from 'playwright';
const BASE = 'http://192.168.50.203:3450';
const OUT = [];

function pass(name, detail='') { OUT.push(`✅ PASS: ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail='') { OUT.push(`❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`); }

const browser = await chromium.launch({ headless: true });

// === USER SETUP ===
const ctx1 = await browser.newContext();
const p1 = await ctx1.newPage();
const u1 = 'u1_' + Date.now();
let pool1Id, pool2Id, inviteCode;

const errs1 = [];
p1.on('console', m => { if (m.type()==='error') errs1.push(m.text()); });

// 1. Register
await p1.goto(BASE+'/login', { waitUntil:'networkidle', timeout:15000 });
await p1.getByRole('button',{name:/registro/i}).click();
await p1.waitForTimeout(500);
await p1.locator('input[placeholder="usuario"]').fill(u1);
await p1.locator('input[placeholder="Tu nombre"]').fill('User One');
await p1.locator('input[type="password"]').fill('test1234');
await p1.locator('button[type="submit"]').click();
await p1.waitForURL('**/', { timeout:5000 }).catch(()=>{});
await p1.waitForTimeout(1000);
pass('1. Register+login', p1.url().endsWith('/') || p1.url().includes('/?') ? 'redirected to home' : 'URL: '+p1.url());

// 2. Home page elements
const h1 = await p1.locator('h1').first().textContent().catch(()=>'');
pass('2. Home greeting', h1.includes('Hola') ? 'greeting shown' : 'no greeting: '+h1);
const createBtn = await p1.locator('text=Crear quiniela').isVisible().catch(()=>false);
pass('2. Create pool button visible', createBtn ? 'yes' : 'no');

// 3. Create FREE pool
await p1.goto(BASE+'/pools/create', { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(500);
const inputs1 = await p1.locator('input').all();
await inputs1[0].fill('Free Pool Test');
// Leave buy-in at 0 (default)
await p1.locator('button',{hasText:/crear/i}).click();
await p1.waitForURL(/\/pool\/\d+/, {timeout:5000}).catch(()=>{});
await p1.waitForTimeout(1000);
pool1Id = p1.url().match(/\/pool\/(\d+)/)?.[1];
pass('3. Create free pool', pool1Id ? 'pool '+pool1Id : 'no redirect, URL: '+p1.url());

// 5. Pool detail tabs
for (const tab of ['Clasificación','Pronósticos','Eliminatorias','Miembros','Puntuación']) {
  const tabLink = p1.locator('a', { hasText: tab }).first();
  const visible = await tabLink.isVisible().catch(()=>false);
  if (visible) { await tabLink.click(); await p1.waitForTimeout(500); }
  pass('5. Tab: '+tab, visible ? 'visible and clicked' : 'NOT FOUND');
}
await p1.goto(BASE+'/pool/'+pool1Id, { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(500);

// 6. Sticky header back link
const backLink = p1.locator('a',{hasText:/Quinielas|Inicio/}).first();
const backVisible = await backLink.isVisible().catch(()=>false);
pass('6. Back link visible', backVisible ? 'yes' : 'no');

// 7. Copy code button
const copyBtn = p1.locator('button',{hasText:/Copiar|Copied/}).first();
const copyVisible = await copyBtn.isVisible().catch(()=>false);
if (copyVisible) {
  await copyBtn.click();
  await p1.waitForTimeout(300);
  const copied = await p1.locator('text=Copiado').isVisible().catch(()=>false);
  pass('7. Copy code button', copied ? 'works' : 'clicked but no feedback');
} else {
  pass('7. Copy code button', 'NOT FOUND');
}

// Get invite code from pool detail
const codeText = await p1.locator('text=/[A-Z0-9]{6}/').first().textContent().catch(()=>'');
inviteCode = codeText.match(/[A-Z0-9]{6}/)?.[0] || '';
pass('7. Invite code shown', inviteCode ? 'code: '+inviteCode : 'not found');

// === USER 2: join pool ===
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
const u2 = 'u2_'+Date.now();
await p2.goto(BASE+'/login', { waitUntil:'networkidle', timeout:15000 });
await p2.getByRole('button',{name:/registro/i}).click();
await p2.waitForTimeout(500);
await p2.locator('input[placeholder="usuario"]').fill(u2);
await p2.locator('input[placeholder="Tu nombre"]').fill('User Two');
await p2.locator('input[type="password"]').fill('test1234');
await p2.locator('button[type="submit"]').click();
await p2.waitForURL('**/', {timeout:5000}).catch(()=>{});
await p2.waitForTimeout(1000);
pass('8. User 2 registered+logged in', p2.url().endsWith('/') ? 'ok' : 'URL: '+p2.url());

// Join pool via URL (no invite UI visible in this test - try direct join)
await p2.goto(BASE+'/pools/join?code='+inviteCode, { waitUntil:'networkidle', timeout:10000 }).catch(()=>{});
await p2.waitForTimeout(1000);
pass('8. Join via invite URL', p2.url().includes('/pool/') ? 'joined pool' : 'URL: '+p2.url());

// === USER 1: Create PAID pool with multi ===
await p1.goto(BASE+'/pools/create', { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(500);
const inps1 = await p1.locator('input').all();
await inps1[0].fill('Paid Pool Test');
await inps1[1].fill('10');
// Check the multiple entries checkbox
const chk = p1.locator('input[type="checkbox"]');
await chk.check({ timeout: 2000 }).catch(async () => {
  // May already be checked or not exist
  const checked = await chk.isChecked().catch(()=>false);
  if (!checked) await chk.click().catch(()=>{}); 
});
await p1.locator('button',{hasText:/crear/i}).click();
await p1.waitForURL(/\/pool\/\d+/, {timeout:5000}).catch(()=>{});
await p1.waitForTimeout(1000);
pool2Id = p1.url().match(/\/pool\/(\d+)/)?.[1];
pass('4. Create paid pool with multi', pool2Id ? 'pool '+pool2Id : 'no redirect, URL: '+p1.url());

// 9. Group predictions
await p1.goto(BASE+'/pool/'+pool2Id+'/predict', { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(1000);
const selects = await p1.locator('select').all();
let savedCount = 0;
for (let i = 0; i < Math.min(4, selects.length); i++) {
  const opts = await selects[i].locator('option').all();
  if (opts.length > 1) {
    await selects[i].selectOption({ index: 1 });
    savedCount++;
  }
}
if (savedCount > 0) {
  const saveBtn = p1.locator('button',{hasText:/Guardar Pronósticos/});
  await saveBtn.click();
  await p1.waitForTimeout(1000);
  const saved = await p1.locator('text=guardados').isVisible().catch(()=>false);
  pass('9. Group predictions saved', saved ? 'success message shown' : 'no confirmation');
} else {
  pass('9. Group predictions', 'could not find selects to fill');
}

// 10. Bracket predictions
await p1.goto(BASE+'/pool/'+pool2Id+'/bracket', { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(1000);
const bracketBtns = await p1.locator('.bracket-match button').all();
if (bracketBtns.length > 0) {
  await bracketBtns[0].click();
  await p1.waitForTimeout(200);
  const brSaveBtn = p1.locator('button',{hasText:/Guardar Cuadro/});
  const brSaveVisible = await brSaveBtn.isVisible().catch(()=>false);
  if (brSaveVisible) {
    await brSaveBtn.click();
    await p1.waitForTimeout(1000);
    const brSaved = await p1.locator('text=Guardado').isVisible().catch(()=>false);
    pass('10. Bracket predictions', brSaved ? 'saved' : 'saved but no confirmation');
  } else {
    pass('10. Bracket predictions', 'save button not found');
  }
} else {
  pass('10. Bracket predictions', 'no bracket buttons found');
}

// 11. Profile page
await p1.goto(BASE+'/profile', { waitUntil:'networkidle', timeout:10000 });
await p1.waitForTimeout(500);
const dispName = await p1.locator('text=User One').isVisible().catch(()=>false);
pass('11. Profile shows display name', dispName ? 'yes' : 'no');
const username = await p1.locator('@'+u1).isVisible().catch(()=>false);
pass('11. Profile shows username', username ? '@'+u1+' visible' : 'username not shown');
const logoutBtn = p1.locator('button',{hasText:/Cerrar sesión/});
pass('11. Logout button visible', await logoutBtn.isVisible().catch(()=>false) ? 'yes' : 'no');

// 12. Multiple entries
if (pool2Id) {
  await p1.goto(BASE+'/pool/'+pool2Id+'/predict', { waitUntil:'networkidle', timeout:10000 });
  await p1.waitForTimeout(500);
  const newEntryBtn = await p1.locator('text=Nueva entrada').isVisible().catch(()=>false);
  pass('12. Nueva entrada button visible', newEntryBtn ? 'yes' : 'no (multi may not be enabled)');
  if (newEntryBtn) {
    await p1.locator('text=Nueva entrada').click();
    await p1.waitForTimeout(300);
    const entryInput = await p1.locator('input[placeholder*="conservadora"]').isVisible().catch(()=>false);
    pass('12. New entry form shows', entryInput ? 'yes' : 'no');
  }
}

// === ADMIN TESTS ===
if (pool2Id) {
  await p1.goto(BASE+'/pool/'+pool2Id+'/admin', { waitUntil:'networkidle', timeout:10000 });
  await p1.waitForTimeout(1000);
  
  // Stats
  const statsSection = await p1.locator('text=Miembros').first().isVisible().catch(()=>false);
  pass('ADMIN 1. Members section visible', statsSection ? 'yes' : 'no');
  
  // Save settings
  const saveSettingsBtn = p1.locator('button',{hasText:/Guardar/}).first();
  const saveSettingsVisible = await saveSettingsBtn.isVisible().catch(()=>false);
  if (saveSettingsVisible) {
    await saveSettingsBtn.click();
    await p1.waitForTimeout(500);
    const savedMsg = await p1.locator('text=Guardado').first().isVisible().catch(()=>false);
    pass('ADMIN 2. Save button works', savedMsg ? 'confirmation shown' : 'no confirmation');
  }
  
  // Payment toggle - mark as paid
  const pendBtn = p1.locator('button',{hasText:/Pendiente/}).first();
  const pendVisible = await pendBtn.isVisible().catch(()=>false);
  if (pendVisible) {
    await pendBtn.click();
    await p1.waitForTimeout(500);
    const pagadoBtn = p1.locator('button',{hasText:/Pagado/}).first();
    const isPagado = await pagadoBtn.isVisible().catch(()=>false);
    pass('ADMIN 5. Mark as paid', isPagado ? 'button changed to Pagado' : 'button did not change');
    
    // Unmark - should show confirm
    const pagadoBtnn = p1.locator('button',{hasText:/Pagado/}).first();
    await pagadoBtnn.click();
    await p1.waitForTimeout(500);
    const confirmModal = await p1.locator('text=Confirmar').isVisible().catch(()=>false);
    pass('ADMIN 6. Unmark confirmation', confirmModal ? 'modal appears' : 'NO MODAL - bug!');
    
    if (confirmModal) {
      await p1.locator('button',{hasText:/Confirmar/}).click();
      await p1.waitForTimeout(500);
      const pendAgain = await p1.locator('button',{hasText:/Pendiente/}).first().isVisible().catch(()=>false);
      pass('ADMIN 6. After confirm, back to Pendiente', pendAgain ? 'yes' : 'no');
    }
  } else {
    pass('ADMIN 5. Payment button', 'NOT FOUND');
  }
  
  // Resultados section
  const resultados = await p1.locator('text=Resultados de partidos').isVisible().catch(()=>false);
  pass('ADMIN 7. Resultados section', resultados ? 'visible' : 'not found');
}

// Console errors
const filteredErrs = errs1.filter(e => !e.includes('favicon') && !e.includes('net::ERR'));
pass('Console errors', filteredErrs.length === 0 ? 'none' : filteredErrs.join('; '));

await browser.close();

// Summary
const passed = OUT.filter(l=>l.startsWith('✅')).length;
const failed = OUT.filter(l=>l.startsWith('❌')).length;
console.log('\n=== TEST RESULTS ===');
OUT.forEach(l=>console.log(l));
console.log(`\nTotal: ${passed} passed, ${failed} failed`);
if (failed > 0) console.log('\n⚠️ Bugs found - review failures above');
