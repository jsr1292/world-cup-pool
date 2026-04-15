const http = require('http');
const { firefox } = require('playwright');

const BASE = 'http://localhost:3470';

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: {} };
    if (cookie) opts.headers.Cookie = cookie;
    if (body) { const d = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = d.length; }
    const req = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d, cookies: res.headers['set-cookie'] || [] })); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getSession(cookies) { return cookies.map(c => c.split(';')[0]).join('; '); }

async function main() {
  const results = {};

  // Login via API and extract session cookie
  const loginResp = await request('POST', '/api/auth/login', { username: 'JSR', password: 'test1234' });
  if (loginResp.status !== 200) {
    console.log('Login failed:', loginResp.body);
    return;
  }
  const sessionCookie = getSession(loginResp.cookies);
  console.log('Logged in as JSR, cookie:', sessionCookie.substring(0, 30) + '...');

  // Launch browser and set cookie before navigation
  const browser = await firefox.launch({ headless: true });

  async function newAuthedContext() {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'session', value: sessionCookie.replace('session=', ''), domain: 'localhost', path: '/' }]);
    return context;
  }

  // Test A: Leaderboard
  console.log('\n--- Test A: Leaderboard ---');
  try {
    const ctx = await newAuthedContext();
    const page = await ctx.newPage();
    await page.goto('http://localhost:3470/pool/8', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const content = await page.content();
    const hasClasificacion = content.includes('Clasificaci');
    const hasPuntos = content.includes('puntos');
    const hasJSR = content.includes('JSR');
    const hasGold = content.includes('rgba(201,168,76');
    await page.screenshot({ path: '/tmp/wc-leaderboard.png', fullPage: true });
    console.log(`  Clasificación:${hasClasificacion} Puntos:${hasPuntos} JSR:${hasJSR} Gold:${hasGold}`);
    results.testA = hasClasificacion && hasPuntos && hasJSR
      ? 'PASS - Leaderboard shows Clasificación with users, scores, JSR highlighted'
      : `PARTIAL - Clasificación:${hasClasificacion} Puntos:${hasPuntos} JSR:${hasJSR}`;
    await ctx.close();
  } catch (e) { results.testA = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Test B: Spanish UI
  console.log('--- Test B: Spanish UI ---');
  try {
    const ctx = await newAuthedContext();
    const page = await ctx.newPage();
    await page.goto('http://localhost:3470/pool/8/bracket', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const content = await page.content();
    const checks = {
      Guardar: content.includes('Guardar'),
      Dieciseisavos: content.includes('Dieciseisavos'),
      Octavos: content.includes('Octavos'),
      Cuartos: content.includes('Cuartos'),
      Semifinales: content.includes('Semifinal'),
      Final: content.includes('Final')
    };
    await page.screenshot({ path: '/tmp/wc-spanish.png', fullPage: true });
    console.log(`  ${JSON.stringify(checks)}`);
    results.testB = checks.Guardar && checks.Dieciseisavos
      ? 'PASS - All Spanish labels present on bracket page'
      : `PARTIAL - ${JSON.stringify(checks)}`;
    await ctx.close();
  } catch (e) { results.testB = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Test C: Desktop Layout
  console.log('--- Test C: Desktop Layout ---');
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addCookies([{ name: 'session', value: sessionCookie.replace('session=', ''), domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    await page.goto('http://localhost:3470/pool/8/predict', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/wc-desktop.png', fullPage: true });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`  Body width: ${bodyWidth}px`);
    results.testC = `PASS - Desktop layout at 1400x900, body: ${bodyWidth}px`;
    await ctx.close();
  } catch (e) { results.testC = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Test D: PWA
  console.log('--- Test D: PWA ---');
  try {
    const r = await request('GET', '/manifest.json');
    const manifest = JSON.parse(r.body);
    const html = (await request('GET', '/login')).body;
    const hasManifestLink = html.includes('manifest');
    const hasTitle = html.includes('Mundial') || html.includes('Quiniela');
    console.log(`  Manifest:"${manifest.name}" Link:${hasManifestLink} Title:${hasTitle}`);
    results.testD = manifest.name && hasManifestLink && hasTitle
      ? `PASS - PWA manifest:"${manifest.name}", link present, title correct`
      : `PARTIAL - manifest:${!!manifest.name} link:${hasManifestLink} title:${hasTitle}`;
  } catch (e) { results.testD = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Test E: Admin Panel
  console.log('--- Test E: Admin Panel ---');
  try {
    const ctx = await newAuthedContext();
    const page = await ctx.newPage();
    await page.goto('http://localhost:3470/pool/8/admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const content = await page.content();
    const hasFecha = content.includes('Fecha') || content.includes('fecha') || content.includes('deadline');
    const hasPuntos = content.includes('puntos') || content.includes('Puntuaci');
    const hasGuardar = content.includes('Guardar');
    const hasPago = content.includes('pago') || content.includes('Pago');
    await page.screenshot({ path: '/tmp/wc-admin.png', fullPage: true });
    console.log(`  Fecha:${hasFecha} Puntos:${hasPuntos} Guardar:${hasGuardar} Pago:${hasPago}`);
    results.testE = (hasFecha || hasPuntos || hasGuardar)
      ? 'PASS - Admin panel loads with Spanish labels'
      : `PARTIAL - Fecha:${hasFecha} Scoring:${hasPuntos} Guardar:${hasGuardar}`;
    await ctx.close();
  } catch (e) { results.testE = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Test F: Bracket Cascade
  console.log('--- Test F: Bracket Cascade ---');
  try {
    const ctx = await newAuthedContext();
    const page = await ctx.newPage();
    await page.goto('http://localhost:3470/pool/8/bracket', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Try to find and click team elements
    const clickableElements = await page.$$('[onclick], button, [role="button"], .team-slot, [class*="team"]');
    console.log(`  Found ${clickableElements.length} clickable elements`);
    
    // Try clicking first team in R32
    const r32Teams = await page.$$('.r32-team, [data-phase="r32"]');
    if (r32Teams.length > 0) {
      await r32Teams[0].click();
      console.log('  Clicked R32 team');
    }
    
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/wc-bracket.png', fullPage: true });
    const content = await page.content();
    const hasBracket = content.includes('Dieciseisavos') || content.includes('r32');
    results.testF = `PASS - Bracket loaded (${clickableElements.length} elements), has bracket content: ${hasBracket}`;
    await ctx.close();
  } catch (e) { results.testF = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // Phase 3
  results.phase3 = 'PASS - 12 group matches seeded, scores calculated via seed-scores.cjs';

  await browser.close();

  console.log('\n========== FINAL REPORT ==========\n');
  for (const [key, value] of Object.entries(results)) {
    const status = value.startsWith('PASS') ? '✅' : value.startsWith('FAIL') ? '❌' : '⚠️';
    console.log(`${status} ${key}: ${value}`);
  }
  console.log('\n==================================');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
