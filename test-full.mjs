#!/usr/bin/env node
/**
 * Comprehensive test: Desktop DnD + Mobile tap-to-rank
 */
import { chromium, devices } from 'playwright';

const BASE = 'http://192.168.50.203:3470';
const POOL_ID = 1;
const SESSION = '994aece24f896423c89faaa852329a822f6df815e138c7b6542d8a3542c77e8d';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const allErrors = [];

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Desktop — verify all 12 groups, test drag operations
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ PHASE 1: Desktop DnD ═══');
  const dCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await dCtx.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);
  const dp = await dCtx.newPage();
  const dErrors = [];
  dp.on('console', msg => { if (msg.type() === 'error') dErrors.push(msg.text()); });
  dp.on('pageerror', e => dErrors.push(`PAGE: ${e.message}`));

  await dp.goto(`${BASE}/pool/${POOL_ID}/predict`, { waitUntil: 'networkidle' });
  await delay(2000);

  // 1a. Check all 12 groups render
  const groupCheck = await dp.evaluate(() => {
    const groups = document.querySelectorAll('.desktop-view');
    const counts = [];
    for (let i = 0; i < groups.length; i++) {
      const items = groups[i].querySelectorAll('[draggable]');
      counts.push(items.length);
    }
    return { total: groups.length, itemsPerGroup: counts };
  });

  console.log(`Groups: ${groupCheck.total}/12 ${groupCheck.total === 12 ? '✅' : '❌'}`);
  const allHave4 = groupCheck.itemsPerGroup.every(c => c === 4);
  console.log(`4 items per group: ${allHave4 ? '✅' : '❌'} ${JSON.stringify(groupCheck.itemsPerGroup)}`);

  // 1b. Drag test: swap row 0 ↔ row 1 in Group A
  const drag1 = await dp.evaluate(async () => {
    const g = document.querySelectorAll('.desktop-view')[0];
    const rows = g.querySelectorAll('[draggable]');
    if (rows.length < 2) return { err: `only ${rows.length} rows` };
    const before = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));

    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    rows[1].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    rows[1].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const after = Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
    return { before, after, swapped: before[0] !== after[0], count: g.querySelectorAll('[draggable]').length };
  });

  console.log(`Drag swap 0↔1: ${JSON.stringify(drag1.before?.slice(0,2))} → ${JSON.stringify(drag1.after?.slice(0,2))}`);
  console.log(`Swap worked: ${drag1.swapped ? '✅' : '❌'} | Items: ${drag1.count}/4`);

  // 1c. Drag row 0 → row 2 (move first to third)
  const drag2 = await dp.evaluate(async () => {
    const g = document.querySelectorAll('.desktop-view')[0];
    const rows = g.querySelectorAll('[draggable]');
    const before = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));

    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    rows[2].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    rows[2].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const after = Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
    return { before, after, count: g.querySelectorAll('[draggable]').length };
  });

  console.log(`Drag 0→2: ${JSON.stringify(drag2.before?.slice(0,3))} → ${JSON.stringify(drag2.after?.slice(0,3))}`);
  console.log(`Items after: ${drag2.count}/4 ${drag2.count === 4 ? '✅' : '❌'}`);

  // 1d. Drag last row to first
  const drag3 = await dp.evaluate(async () => {
    const g = document.querySelectorAll('.desktop-view')[0];
    const rows = g.querySelectorAll('[draggable]');
    const before = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));

    const dt = new DataTransfer();
    rows[3].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    rows[0].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    rows[0].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    rows[3].dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const after = Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
    return { before, after, count: g.querySelectorAll('[draggable]').length };
  });

  console.log(`Drag 3→0: ${JSON.stringify(drag3.before)} → ${JSON.stringify(drag3.after)}`);
  console.log(`Items after: ${drag3.count}/4 ${drag3.count === 4 ? '✅' : '❌'}`);

  // 1e. Check all groups still have 4 items after operations
  const postCheck = await dp.evaluate(() => {
    const groups = document.querySelectorAll('.desktop-view');
    const counts = [];
    for (let i = 0; i < groups.length; i++) {
      counts.push(groups[i].querySelectorAll('[draggable]').length);
    }
    return counts;
  });
  const allStill4 = postCheck.every(c => c === 4);
  console.log(`All groups still have 4 items: ${allStill4 ? '✅' : '❌'} ${JSON.stringify(postCheck)}`);

  // 1f. Check Group B (untouched) still has correct order
  const groupBCheck = await dp.evaluate(() => {
    const g = document.querySelectorAll('.desktop-view')[1];
    const rows = g.querySelectorAll('[draggable]');
    return Array.from(rows).map(r => r.textContent.trim().substring(0, 25));
  });
  console.log(`Group B (untouched): ${JSON.stringify(groupBCheck)}`);

  await dp.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-desktop-test.png' });

  // 1g. Wait for auto-save, reload, verify persistence
  await delay(1500);
  await dp.reload({ waitUntil: 'networkidle' });
  await delay(2000);

  const afterReload = await dp.evaluate(() => {
    const g = document.querySelectorAll('.desktop-view')[0];
    const rows = g.querySelectorAll('[draggable]');
    return Array.from(rows).map(r => r.textContent.trim().substring(0, 25));
  });
  console.log(`After reload Group A: ${JSON.stringify(afterReload)}`);
  const reloadedCount = await dp.evaluate(() => {
    const g = document.querySelectorAll('.desktop-view')[0];
    return g.querySelectorAll('[draggable]').length;
  });
  console.log(`Items after reload: ${reloadedCount}/4 ${reloadedCount === 4 ? '✅' : '❌'}`);

  await dCtx.close();

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Mobile — verify tap-to-rank UI
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 2: Mobile tap-to-rank ═══');
  const iPhone = devices['iPhone 14'];
  const mCtx = await browser.newContext({ ...iPhone, hasTouch: true });
  await mCtx.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);
  const mp = await mCtx.newPage();
  const mErrors = [];
  mp.on('console', msg => { if (msg.type() === 'error') mErrors.push(msg.text()); });
  mp.on('pageerror', e => mErrors.push(`PAGE: ${e.message}`));

  await mp.goto(`${BASE}/pool/${POOL_ID}/predict`, { waitUntil: 'networkidle' });
  await delay(2000);

  // 2a. Check mobile view is visible, desktop is hidden
  const viewCheck = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const dv = document.querySelectorAll('.desktop-view');
    const mDisplay = mv.length > 0 ? getComputedStyle(mv[0]).display : 'N/A';
    const dDisplay = dv.length > 0 ? getComputedStyle(dv[0]).display : 'N/A';
    return {
      mobileCount: mv.length,
      desktopCount: dv.length,
      mobileDisplay: mDisplay,
      desktopDisplay: dDisplay,
    };
  });

  console.log(`Mobile visible: ${viewCheck.mobileDisplay} (should NOT be 'none') ${viewCheck.mobileDisplay !== 'none' ? '✅' : '❌'}`);
  console.log(`Desktop hidden: ${viewCheck.desktopDisplay} (should be 'none') ${viewCheck.desktopDisplay === 'none' ? '✅' : '❌'}`);

  // 2b. Check Group A buttons exist
  const btnCheck = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    if (!gA) return { error: 'No mobile group A' };
    const btns = gA.querySelectorAll('button');
    const texts = Array.from(btns).map(b => b.textContent.trim());
    // Check team rows
    const rows = gA.querySelectorAll('[draggable]');
    const teamTexts = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));
    return { buttonCount: btns.length, buttonTexts: texts, draggableCount: rows.length, teamTexts };
  });

  console.log(`Group A buttons: ${btnCheck.buttonCount} (expect 16) ${btnCheck.buttonCount === 16 ? '✅' : '❌'}`);
  console.log(`Button texts: ${JSON.stringify(btnCheck.buttonTexts)}`);
  console.log(`Draggable rows: ${btnCheck.draggableCount} (expect 4)`);

  // 2c. Test tap — click "1" button for first team
  const tapResult = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    const btns = gA.querySelectorAll('button');
    // Find the first "1" button
    const btn1 = Array.from(btns).find(b => b.textContent.trim() === '1');
    if (!btn1) return { error: 'No button "1" found' };

    btn1.click();
    return { clicked: '1', totalButtons: btns.length };
  });
  console.log(`Tap result: ${JSON.stringify(tapResult)}`);

  await delay(500);

  // 2d. Check state after tap
  const afterTap = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    const btns = gA.querySelectorAll('button');

    // Check which buttons are "active" (have gold styling)
    const activeBtns = Array.from(btns).filter(b => {
      const bg = getComputedStyle(b).background;
      return bg.includes('201, 168') || bg.includes('201,168');
    });

    return {
      activeButtons: activeBtns.length,
      activeTexts: activeBtns.map(b => b.textContent.trim()),
    };
  });
  console.log(`Active buttons after tap: ${JSON.stringify(afterTap)}`);

  // 2e. Tap more buttons to fill Group A
  const fillResult = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    const btns = gA.querySelectorAll('button');

    // Tap "2" for second team
    const btn2 = Array.from(btns).filter(b => b.textContent.trim() === '2')[1];
    if (btn2) btn2.click();
    // Tap "3" for third team
    const btn3 = Array.from(btns).filter(b => b.textContent.trim() === '3')[2];
    if (btn3) btn3.click();
    // Tap "4" for fourth team
    const btn4 = Array.from(btns).filter(b => b.textContent.trim() === '4')[3];
    if (btn4) btn4.click();

    return { filled: true };
  });
  console.log(`Fill all positions: ${JSON.stringify(fillResult)}`);

  await delay(1000);

  // 2f. Verify no teams missing
  const teamCheck = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    // Count teams displayed
    const rows = gA.querySelectorAll('[draggable]');
    return { teamCount: rows.length };
  });
  console.log(`Teams in Group A after fills: ${teamCheck.teamCount}/4 ${teamCheck.teamCount === 4 ? '✅' : '❌'}`);

  await mp.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-mobile-test.png' });

  // 2g. Reload and verify persistence
  await delay(1500);
  await mp.reload({ waitUntil: 'networkidle' });
  await delay(2000);

  const mobileReload = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view');
    const gA = mv[0];
    const btns = gA ? gA.querySelectorAll('button') : [];
    return { buttonCount: btns.length };
  });
  console.log(`After reload buttons: ${mobileReload.buttonCount} ${mobileReload.buttonCount === 16 ? '✅' : '❌'}`);

  await mCtx.close();

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ SUMMARY ═══');
  console.log(`Desktop errors: ${dErrors.length === 0 ? 'None ✅' : dErrors.join(', ')}`);
  console.log(`Mobile errors: ${mErrors.length === 0 ? 'None ✅' : mErrors.join(', ')}`);

  await browser.close();
  console.log('\nDone.');
})();
