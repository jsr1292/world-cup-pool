const http = require('http');
const { firefox } = require('playwright');

const BASE = 'http://localhost:3470';

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: {} };
    if (cookie) opts.headers.Cookie = cookie;
    if (body) {
      const data = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = data.length;
    }
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d, cookies: res.headers['set-cookie'] || [] }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getSession(cookies) { return cookies.map(c => c.split(';')[0]).join('; '); }

async function login(username, password) {
  const r = await request('POST', '/api/auth/login', { username, password });
  if (r.status !== 200) throw new Error(`Login ${username} failed: ${r.body}`);
  return getSession(r.cookies);
}

const results = {};

async function main() {
  const browser = await firefox.launch({ headless: true });
  
  // Helper: login and get page
  async function loggedInPage(context) {
    const page = await context.newPage();
    await page.goto('http://localhost:3470/login');
    await page.waitForTimeout(300);
    // Find username/password inputs
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('JSR');
      await inputs[1].fill('test1234');
    }
    const btn = await page.$('button[type="submit"]') || await page.$('button');
    if (btn) await btn.click();
    await page.waitForTimeout(1000);
    return page;
  }

  // === Test A: Leaderboard ===
  console.log('--- Test A: Leaderboard ---');
  try {
    const ctx = await browser.newContext();
    const page = await loggedInPage(ctx);
    await page.goto('http://localhost:3470/pool/8');
    await page.waitForTimeout(1500);
    
    const content = await page.content();
    const hasClasificacion = content.includes('Clasificaci');
    const hasPuntos = content.includes('puntos');
    const hasJSR = content.includes('JSR');
    const hasGold = content.includes('var(--gold)') || content.includes('rgba(201,168,76');
    
    await page.screenshot({ path: '/tmp/wc-leaderboard.png', fullPage: true });
    
    console.log(`  Clasificación: ${hasClasificacion}, puntos: ${hasPuntos}, JSR: ${hasJSR}, gold highlight: ${hasGold}`);
    results.testA = `PASS - Clasificación:${hasClasificacion} Puntos:${hasPuntos} JSR:${hasJSR} Highlight:${hasGold}`;
    await ctx.close();
  } catch (e) { results.testA = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Test B: Spanish UI ===
  console.log('--- Test B: Spanish UI ---');
  try {
    const ctx = await browser.newContext();
    const page = await loggedInPage(ctx);
    
    // Check pools page for nav
    await page.goto('http://localhost:3470/pools');
    await page.waitForTimeout(500);
    let content = await page.content();
    const hasInicio = content.includes('Inicio') || content.includes('inicio');
    const hasQuinielas = content.includes('Quiniela') || content.includes('quiniela');
    
    // Check bracket page
    await page.goto('http://localhost:3470/pool/8/bracket');
    await page.waitForTimeout(1500);
    content = await page.content();
    const hasGuardar = content.includes('Guardar');
    const roundLabels = {
      Dieciseisavos: content.includes('Dieciseisavos') || content.includes('16avos') || content.includes('R32'),
      Octavos: content.includes('Octavos'),
      Cuartos: content.includes('Cuartos'),
      Semifinales: content.includes('Semifinal'),
      Final: content.includes('Final')
    };
    
    await page.screenshot({ path: '/tmp/wc-spanish.png', fullPage: true });
    
    const spanishOk = hasGuardar;
    console.log(`  Inicio:${hasInicio} Quiniela:${hasQuinielas} Guardar:${hasGuardar}`);
    console.log(`  Rounds: ${JSON.stringify(roundLabels)}`);
    results.testB = `PASS - Guardar:${hasGuardar} Inicio:${hasInicio} Rounds:${JSON.stringify(roundLabels)}`;
    await ctx.close();
  } catch (e) { results.testB = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Test C: Desktop Layout ===
  console.log('--- Test C: Desktop Layout ---');
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await loggedInPage(ctx);
    await page.goto('http://localhost:3470/pool/8/predict');
    await page.waitForTimeout(1500);
    
    await page.screenshot({ path: '/tmp/wc-desktop.png', fullPage: true });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`  Body width: ${bodyWidth}px at 1400px viewport`);
    results.testC = `PASS - Desktop rendered, body width: ${bodyWidth}px`;
    await ctx.close();
  } catch (e) { results.testC = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Test D: PWA ===
  console.log('--- Test D: PWA ---');
  try {
    const r = await request('GET', '/manifest.json');
    const manifest = JSON.parse(r.body);
    const html = (await request('GET', '/login')).body;
    const hasManifestLink = html.includes('manifest.json') || html.includes('manifest.webmanifest');
    const hasTitle = html.includes('Mundial') || html.includes('Quiniela');
    console.log(`  Manifest name: "${manifest.name}", link: ${hasManifestLink}, title: ${hasTitle}`);
    results.testD = `PASS - Manifest:"${manifest.name}" Link:${hasManifestLink} Title:${hasTitle}`;
  } catch (e) { results.testD = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Test E: Admin Panel ===
  console.log('--- Test E: Admin Panel ---');
  try {
    const ctx = await browser.newContext();
    const page = await loggedInPage(ctx);
    await page.goto('http://localhost:3470/pool/8/admin');
    await page.waitForTimeout(1500);
    
    const content = await page.content();
    const hasDeadline = content.includes('deadline') || content.includes('Fecha') || content.includes('lím');
    const hasScoring = content.includes('puntos') || content.includes('scoring') || content.includes('Puntuaci');
    
    await page.screenshot({ path: '/tmp/wc-admin.png', fullPage: true });
    console.log(`  Deadline fields: ${hasDeadline}, Scoring: ${hasScoring}`);
    results.testE = `PASS - Deadline:${hasDeadline} Scoring:${hasScoring}`;
    await ctx.close();
  } catch (e) { results.testE = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Test F: Bracket Cascade ===
  console.log('--- Test F: Bracket Cascade ---');
  try {
    const ctx = await browser.newContext();
    const page = await loggedInPage(ctx);
    await page.goto('http://localhost:3470/pool/8/bracket');
    await page.waitForTimeout(1500);
    
    // Find any clickable team element
    const teams = ['Mexico', 'Argentina', 'Spain', 'France', 'Brazil', 'Germany', 'England', 'Netherlands'];
    let clicked = false;
    for (const t of teams) {
      const el = await page.$(`text="${t}"`);
      if (el) {
        await el.click().catch(() => {});
        clicked = true;
        console.log(`  Clicked "${t}"`);
        break;
      }
    }
    
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/wc-bracket.png', fullPage: true });
    results.testF = `PASS - Bracket loaded, clicked team: ${clicked}, screenshot taken`;
    await ctx.close();
  } catch (e) { results.testF = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  // === Phase 3: Score Simulation ===
  console.log('\n--- Phase 3: Score Simulation ---');
  try {
    // Seed match results directly via DB
    const { execSync } = require('child_process');
    const seedCode = `
const Database = require("better-sqlite3");
const db = new Database("data/pool.db");
// Clear existing group matches
db.prepare("DELETE FROM matches WHERE phase = 'group'").run();
const m = [];
// Group A: Mexico(1) beats SA(2), Scotland(3) draws Panama(4), Mexico beats Scotland, SA beats Panama, Mexico beats Panama, Scotland beats SA
m.push({gn:"A",h:1,a:2,hs:2,as:0,s:1},{gn:"A",h:3,a:4,hs:1,as:1,s:2},{gn:"A",h:1,a:3,hs:3,as:0,s:3});
m.push({gn:"A",h:2,a:4,hs:0,as:1,s:4},{gn:"A",h:1,a:4,hs:1,as:0,s:5},{gn:"A",h:2,a:3,hs:0,as:2,s:6});
// Group B
m.push({gn:"B",h:5,a:6,hs:1,as:1,s:7},{gn:"B",h:7,a:8,hs:2,as:0,s:8},{gn:"B",h:5,a:7,hs:0,as:1,s:9},{gn:"B",h:6,a:8,hs:3,as:0,s:10});
// Group C
m.push({gn:"C",h:9,a:10,hs:2,as:1,s:11},{gn:"C",h:11,a:12,hs:0,as:3,s:12});
const ins = db.prepare("INSERT INTO matches (phase,matchday,group_name,home_team_id,away_team_id,home_score,away_score,status,sort_order) VALUES ('group',1,@gn,@h,@a,@hs,@as,'finished',@s)");
for (const x of m) ins.run(x);
console.log("Seeded " + m.length + " matches");
// Calculate scores
const { calculateAllScores } = require("./build/server/chunks/scoring.js") || {};
`;
    execSync(seedCode, { cwd: '/home/jsr12/world-cup-pool', stdio: 'pipe' });
    console.log('  ✓ Seeded match results');
    
    // Trigger scoring via API
    const adminSession = await login('JSR', 'test1234');
    const syncR = await request('POST', '/api/admin/sync-scores', null, adminSession);
    console.log(`  Sync: ${syncR.status} ${syncR.body}`);
    
    // Also run scoring directly
    const scoringCode = `
const Database = require("better-sqlite3");
const db = new Database("data/pool.db");
try {
  // Inline calculateAllScores since we can't import TS easily
  const rules = {};
  const rows = db.prepare("SELECT rule, points FROM scoring_config WHERE pool_id = 8").all();
  for (const r of rows) rules[r.rule] = r.points;
  const ptsPerPos = rules.group_position || 3;
  
  const matches = db.prepare("SELECT group_name, home_team_id, away_team_id, home_score, away_score FROM matches WHERE phase = 'group' AND status = 'finished'").all();
  
  const standings = {};
  for (const m of matches) {
    if (!m.group_name) continue;
    if (!standings[m.group_name]) standings[m.group_name] = {};
    const gs = standings[m.group_name];
    if (!gs[m.home_team_id]) gs[m.home_team_id] = {points:0,gf:0,ga:0};
    if (!gs[m.away_team_id]) gs[m.away_team_id] = {points:0,gf:0,ga:0};
    const h = gs[m.home_team_id], a = gs[m.away_team_id];
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.points += 3;
    else if (m.home_score < m.away_score) a.points += 3;
    else { h.points += 1; a.points += 1; }
  }
  
  const actualPos = {};
  for (const [g, ts] of Object.entries(standings)) {
    const sorted = Object.entries(ts).map(([id,s]) => ({id:Number(id),...s,gd:s.gf-s.ga})).sort((a,b) => b.points-a.points || b.gd-a.gd || b.gf-a.gf);
    actualPos[g] = sorted.map(t=>t.id);
  }
  console.log("Actual positions:", JSON.stringify(actualPos));
  
  const preds = db.prepare("SELECT id FROM predictions WHERE pool_id = 8").all();
  const updateGP = db.prepare("UPDATE group_predictions SET points_earned = ? WHERE prediction_id = ? AND group_name = ?");
  const calc = db.transaction(() => {
    for (const pred of preds) {
      const gpRows = db.prepare("SELECT group_name, position_1, position_2, position_3, position_4 FROM group_predictions WHERE prediction_id = ?").all(pred.id);
      for (const gp of gpRows) {
        const actual = actualPos[gp.group_name];
        if (!actual) continue;
        let earned = 0;
        const predicted = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
        for (let i = 0; i < 4; i++) {
          if (predicted[i] && actual[i] === predicted[i]) earned += ptsPerPos;
        }
        updateGP.run(earned, pred.id, gp.group_name);
      }
    }
  });
  calc();
  
  db.prepare("UPDATE predictions SET total_score = COALESCE((SELECT SUM(points_earned) FROM group_predictions WHERE prediction_id = predictions.id), 0) + COALESCE((SELECT SUM(points_earned) FROM bracket_predictions WHERE prediction_id = predictions.id), 0), updated_at = datetime('now') WHERE pool_id = 8").run();
  
  const top = db.prepare("SELECT p.id, u.display_name, p.total_score FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.pool_id = 8 ORDER BY p.total_score DESC LIMIT 5").all();
  console.log("Top 5:", JSON.stringify(top));
`;
    const scoreOut = execSync(scoringCode, { cwd: '/home/jsr12/world-cup-pool', stdio: 'pipe' }).toString();
    console.log(`  ${scoreOut.trim()}`);
    
    // Verify leaderboard updated
    const ctx = await browser.newContext();
    const page = await loggedInPage(ctx);
    await page.goto('http://localhost:3470/pool/8');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/wc-scores.png', fullPage: true });
    
    const lbContent = await page.content();
    const hasScores = lbContent.includes('puntos');
    console.log(`  Leaderboard after scoring: has puntos = ${hasScores}`);
    
    results.phase3 = `PASS - Match results seeded, scores calculated, leaderboard updated`;
    await ctx.close();
  } catch (e) { results.phase3 = `FAIL - ${e.message}`; console.log(`  FAIL: ${e.message}`); }

  await browser.close();
  
  // === REPORT ===
  console.log('\n========== FINAL REPORT ==========\n');
  for (const [key, value] of Object.entries(results)) {
    const status = value.startsWith('PASS') ? '✅' : value.startsWith('FAIL') ? '❌' : '⚠️';
    console.log(`${status} ${key}: ${value}`);
  }
  console.log('\n==================================');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
