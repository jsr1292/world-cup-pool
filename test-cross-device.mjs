#!/usr/bin/env node
import { chromium, devices } from 'playwright';
const BASE = 'http://192.168.50.203:3470';
const SESSION = '994aece24f896423c89faaa852329a822f6df815e138c7b6542d8a3542c77e8d';
const delay = ms => new Promise(r => setTimeout(r, ms));

function getTeamNames(text) {
  const names = [];
  for (const t of ['Mexico','S. Africa','Scotland','Panama','Canada','Switzerland','Turkey','Haiti']) {
    if (text.includes(t)) names.push(t);
  }
  return names;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ══ PART 1: DESKTOP — reorder Group A & B ══
  console.log('══ PART 1: DESKTOP — reorder groups ══');
  const dCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await dCtx.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);
  const dp = await dCtx.newPage();
  await dp.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await delay(2000);

  // Drag swap Group A: row 0 ↔ row 1
  const dragA = await dp.evaluate(async () => {
    const g = document.querySelectorAll('.desktop-view')[0];
    const rows = g.querySelectorAll('[draggable]');
    const before = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    rows[1].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    rows[1].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const after = Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
    return { before, after, count: g.querySelectorAll('[draggable]').length };
  });
  console.log('Group A before:', JSON.stringify(dragA.before));
  console.log('Group A after:', JSON.stringify(dragA.after), `(${dragA.count} items)`);

  // Drag swap Group B: row 0 ↔ row 1
  const dragB = await dp.evaluate(async () => {
    const g = document.querySelectorAll('.desktop-view')[1];
    const rows = g.querySelectorAll('[draggable]');
    const before = Array.from(rows).map(r => r.textContent.trim().substring(0, 25));
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    rows[1].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    rows[1].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const after = Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
    return { before, after, count: g.querySelectorAll('[draggable]').length };
  });
  console.log('Group B before:', JSON.stringify(dragB.before));
  console.log('Group B after:', JSON.stringify(dragB.after), `(${dragB.count} items)`);

  // Wait for auto-save
  await delay(2000);
  await dCtx.close();

  // ══ PART 2: MOBILE — verify desktop state, then modify Group A ══
  console.log('\n══ PART 2: MOBILE — verify & modify ══');
  const mCtx = await browser.newContext({ ...devices['iPhone 14'], hasTouch: true });
  await mCtx.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);
  const mp = await mCtx.newPage();
  await mp.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await delay(3000);

  // Check mobile view is showing
  const viewCheck = await mp.evaluate(() => {
    const mv = document.querySelectorAll('.mobile-view')[0];
    const dv = document.querySelectorAll('.desktop-view')[0];
    return {
      mobileDisplay: mv ? getComputedStyle(mv).display : 'missing',
      desktopDisplay: dv ? getComputedStyle(dv).display : 'missing',
    };
  });
  console.log(`Mobile: ${viewCheck.mobileDisplay}, Desktop: ${viewCheck.desktopDisplay}`);

  // Check Group A state on mobile — should match desktop drag result
  const mobileA = await mp.evaluate(() => {
    const g = document.querySelectorAll('.mobile-view')[0];
    const text = g.textContent;
    // Extract team names in order from the text
    const teams = [];
    for (const t of ['Mexico','S. Africa','Scotland','Panama','Canada','Switzerland','Turkey','Haiti']) {
      if (text.includes(t)) teams.push(t);
    }
    // Check active buttons
    const btns = g.querySelectorAll('button');
    const active = Array.from(btns).filter(b => {
      const bg = getComputedStyle(b).background;
      return bg.includes('201, 168') || bg.includes('201,168');
    });
    return { teams, activeBtns: active.length };
  });
  console.log('Mobile Group A teams:', JSON.stringify(mobileA.teams), `active: ${mobileA.activeBtns}`);

  // Check Group B on mobile
  const mobileB = await mp.evaluate(() => {
    const g = document.querySelectorAll('.mobile-view')[1];
    const text = g.textContent;
    const teams = [];
    for (const t of ['Canada','Switzerland','Turkey','Haiti']) {
      if (text.includes(t)) teams.push(t);
    }
    return { teams };
  });
  console.log('Mobile Group B teams:', JSON.stringify(mobileB.teams));

  // Now MODIFY Group A on mobile — tap first button to toggle position 1 for team 1
  const btns = mp.locator('.mobile-view').first().locator('button');
  const btnCount = await btns.count();
  console.log(`Tapping button 0 of ${btnCount}...`);
  if (btnCount > 0) {
    await btns.nth(0).click();
    await delay(500);

    const afterTap = await mp.evaluate(() => {
      const g = document.querySelectorAll('.mobile-view')[0];
      const btns = g.querySelectorAll('button');
      const first = btns[0];
      return { bg: first.style.background, text: first.textContent.trim() };
    });
    console.log('Button 0 after tap:', JSON.stringify(afterTap));
  }

  await delay(2000); // auto-save
  await mp.screenshot({ path: '/home/jsr12/.openclaw/workspace/cross-mobile.png' });
  await mCtx.close();

  // ══ PART 3: BACK TO DESKTOP — verify mobile changes stuck ══
  console.log('\n══ PART 3: DESKTOP — verify mobile changes ══');
  const dCtx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await dCtx2.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);
  const dp2 = await dCtx2.newPage();
  await dp2.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await delay(2000);

  const finalA = await dp2.evaluate(() => {
    const g = document.querySelectorAll('.desktop-view')[0];
    return Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
  });
  console.log('Final Group A:', JSON.stringify(finalA));
  console.log(`Group A items: ${finalA.length}/4 ${finalA.length === 4 ? '✅' : '❌'}`);

  const finalB = await dp2.evaluate(() => {
    const g = document.querySelectorAll('.desktop-view')[1];
    return Array.from(g.querySelectorAll('[draggable]')).map(r => r.textContent.trim().substring(0, 25));
  });
  console.log('Final Group B:', JSON.stringify(finalB));
  console.log(`Group B items: ${finalB.length}/4 ${finalB.length === 4 ? '✅' : '❌'}`);

  // Check if Group A changed from mobile tap
  const aSame = JSON.stringify(dragA.after) === JSON.stringify(finalA);
  console.log(`Group A changed by mobile: ${!aSame ? '✅ yes' : '⚠️ no change detected'}`);

  // Check if Group B is still the same as desktop left it
  const bSame = JSON.stringify(dragB.after) === JSON.stringify(finalB);
  console.log(`Group B untouched by mobile: ${bSame ? '✅' : '❌'}`);

  await dp2.screenshot({ path: '/home/jsr12/.openclaw/workspace/cross-desktop-final.png' });
  await dCtx2.close();
  await browser.close();
  console.log('\nDone.');
})();
