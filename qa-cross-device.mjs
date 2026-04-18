#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE = 'http://192.168.50.203:3470';
const USER = `qa_x${Date.now().toString().slice(-6)}`;
const PASS = 'TestPass123!';

async function run() {
  const browser = await chromium.launch({ headless: true });
  
  // Desktop context (hover-based detection)
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  
  // Mobile context with touch
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  
  const desktopPage = await desktopContext.newPage();
  const mobilePage = await mobileContext.newPage();
  
  // ================================================================
  // SETUP: Register, Login, Join Pool
  // ================================================================
  await desktopPage.goto(BASE, { waitUntil: 'networkidle' });
  
  console.log('=== SETUP ===');
  await desktopPage.evaluate(async ({ u, p }) => {
    await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    await fetch('/api/pools/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'IVSNYMA2' }) });
  }, { u: USER, p: PASS });
  console.log('Registered and joined pool:', USER);
  
  // Transfer cookies
  const cookies = await desktopContext.cookies();
  await mobileContext.addCookies(cookies);
  console.log('Cookies transferred to mobile');
  
  // ================================================================
  // PART 1: MOBILE - Initial position assignment
  // ================================================================
  console.log('\n========== PART 1: MOBILE - Initial Assignment ==========');
  
  await mobilePage.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(3000);
  
  // Verify mobile view is active
  const mobileViewDisplay = await mobilePage.locator('.mobile-view').first().evaluate(el => getComputedStyle(el).display);
  const desktopViewDisplay = await mobilePage.locator('.desktop-view').first().evaluate(el => getComputedStyle(el).display);
  console.log('Mobile view visible:', mobileViewDisplay !== 'none' ? 'YES ✅' : 'NO ❌');
  console.log('Desktop view hidden:', desktopViewDisplay === 'none' ? 'YES ✅' : 'NO ❌');
  
  // Assign Group A positions using title-based button locators
  // Team indices 0-3 get positions 1-4 respectively
  console.log('\n--- Assigning Group A positions on mobile ---');
  
  for (let pos = 1; pos <= 4; pos++) {
    const btn = mobilePage.locator(`button[title="${['1st','2nd','3rd','4th'][pos-1]}"]`).nth(0);
    await btn.click({ force: true });
    await mobilePage.waitForTimeout(200);
    console.log(`Clicked position ${pos} for team ${pos}`);
  }
  
  await mobilePage.waitForTimeout(2500);
  
  // Record Group A order after mobile assignment
  const mobileGroupAInitial = [];
  const groupATeamNames = ['Mexico', 'Panama', 'Scotland', 'S. Africa'];
  for (const name of groupATeamNames) {
    const el = mobilePage.locator('.mobile-view', { hasText: name }).first();
    const text = await el.textContent();
    mobileGroupAInitial.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
  }
  console.log('Mobile Group A after initial assignment:', mobileGroupAInitial);
  
  // ================================================================
  // PART 2: DESKTOP - Verify sync and drag reorder
  // ================================================================
  console.log('\n========== PART 2: DESKTOP - Verify & Drag Reorder ==========');
  
  await desktopPage.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(3000);
  
  // Verify desktop view
  const deskViewDisplay = await desktopPage.locator('.desktop-view').first().evaluate(el => getComputedStyle(el).display);
  console.log('Desktop view visible:', deskViewDisplay !== 'none' ? 'YES ✅' : 'NO ❌');
  
  // Check if mobile assignment synced - look for non-"Vacío" slots
  const deskGroupAContainer = desktopPage.locator('.desktop-view .group-card').first();
  const deskSlots = deskGroupAContainer.locator('div[style*="display: flex"][style*="align-items: center"]');
  
  const deskGroupAInitial = [];
  for (let i = 0; i < 4; i++) {
    const slot = deskSlots.nth(i);
    const text = await slot.textContent();
    deskGroupAInitial.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
  }
  console.log('Desktop Group A (should match mobile):', deskGroupAInitial);
  
  // Check if sync happened
  const syncMatch = deskGroupAInitial.some(s => !s.includes('Vacío'));
  console.log('Mobile-to-desktop sync detected?', syncMatch ? 'YES ✅' : 'NO ❌ (slots still empty)');
  
  // If slots have teams, try drag reorder
  if (syncMatch) {
    const filledSlots = deskSlots.filter({ hasNot: desktopPage.locator('text="Vacío"') });
    const filledCount = await filledSlots.count();
    console.log('Filled slots in Group A:', filledCount);
    
    if (filledCount >= 4) {
      // Drag slot 0 to slot 3
      const src = filledSlots.nth(0);
      const dest = filledSlots.nth(3);
      const srcBox = await src.boundingBox();
      const destBox = await dest.boundingBox();
      
      if (srcBox && destBox) {
        await desktopPage.mouse.move(srcBox.x + srcBox.width/2, srcBox.y + srcBox.height/2);
        await desktopPage.mouse.down();
        await desktopPage.waitForTimeout(100);
        await desktopPage.mouse.move(destBox.x + destBox.width/2, destBox.y + destBox.height/2, { steps: 10 });
        await desktopPage.mouse.up();
        console.log('Dragged first team to last position in Group A');
      }
      
      await desktopPage.waitForTimeout(2500);
      
      const deskGroupAAfterDrag = [];
      for (let i = 0; i < 4; i++) {
        const slot = deskSlots.nth(i);
        const text = await slot.textContent();
        deskGroupAAfterDrag.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
      }
      console.log('Desktop Group A after drag:', deskGroupAAfterDrag);
      console.log('Order changed?', JSON.stringify(deskGroupAAfterDrag) !== JSON.stringify(deskGroupAInitial) ? 'YES ✅' : 'NO ❌');
    }
  } else {
    console.log('Cannot test drag - slots are empty (sync failed)');
  }
  
  // Also drag Group B
  const deskGroupB = desktopPage.locator('.desktop-view .group-card').nth(1);
  const deskSlotsB = deskGroupB.locator('div[style*="display: flex"][style*="align-items: center"]');
  const filledSlotsB = deskSlotsB.filter({ hasNot: desktopPage.locator('text="Vacío"') });
  
  if (await filledSlotsB.count() >= 4) {
    const srcB = filledSlotsB.nth(0);
    const destB = filledSlotsB.nth(3);
    const srcBoxB = await srcB.boundingBox();
    const destBoxB = await destB.boundingBox();
    
    if (srcBoxB && destBoxB) {
      await desktopPage.mouse.move(srcBoxB.x + srcBoxB.width/2, srcBoxB.y + srcBoxB.height/2);
      await desktopPage.mouse.down();
      await desktopPage.waitForTimeout(100);
      await desktopPage.mouse.move(destBoxB.x + destBoxB.width/2, destBoxB.y + destBoxB.height/2, { steps: 10 });
      await desktopPage.mouse.up();
      console.log('Dragged first team to last position in Group B');
    }
    await desktopPage.waitForTimeout(2500);
  }
  
  // ================================================================
  // PART 3: MOBILE - Verify sync and modify
  // ================================================================
  console.log('\n========== PART 3: MOBILE - Verify & Modify ==========');
  
  await mobilePage.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(3000);
  
  // Get mobile Group A order
  const mobileGroupAAfterSync = [];
  for (const name of ['Mexico', 'Panama', 'Scotland', 'S. Africa']) {
    const el = mobilePage.locator('.mobile-view', { hasText: name }).first();
    const text = await el.textContent();
    mobileGroupAAfterSync.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
  }
  console.log('Mobile Group A (after desktop drag sync):', mobileGroupAAfterSync);
  
  // Modify Group A on mobile - change first team to position 4
  console.log('\n--- Modifying Group A on mobile ---');
  
  // Click position 4 for first team
  const pos4Btn = mobilePage.locator('button[title="4th"]').first();
  await pos4Btn.click({ force: true });
  console.log('Changed first team to position 4');
  
  await mobilePage.waitForTimeout(2500);
  
  const mobileGroupAAfterMod = [];
  for (const name of ['Mexico', 'Panama', 'Scotland', 'S. Africa']) {
    const el = mobilePage.locator('.mobile-view', { hasText: name }).first();
    const text = await el.textContent();
    mobileGroupAAfterMod.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
  }
  console.log('Mobile Group A after modification:', mobileGroupAAfterMod);
  console.log('Group A changed on mobile?', JSON.stringify(mobileGroupAAfterMod) !== JSON.stringify(mobileGroupAAfterSync) ? 'YES ✅' : 'NO ❌');
  
  // ================================================================
  // PART 4: DESKTOP - Final verification
  // ================================================================
  console.log('\n========== PART 4: BACK TO DESKTOP ==========');
  
  await desktopPage.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(3000);
  
  const finalDeskGroupA = [];
  for (let i = 0; i < 4; i++) {
    const slot = deskSlots.nth(i);
    const text = await slot.textContent();
    finalDeskGroupA.push(text.trim().substring(0, 20).replace(/\s+/g, ' '));
  }
  console.log('Final Desktop Group A:', finalDeskGroupA);
  console.log('Desktop synced from mobile modification?', JSON.stringify(finalDeskGroupA) === JSON.stringify(mobileGroupAAfterMod) ? 'YES ✅' : 'NO ❌');
  
  // ================================================================
  // VERIFICATION
  // ================================================================
  console.log('\n========== VERIFICATION ==========');
  
  const totalGroups = await desktopPage.locator('.desktop-view .group-card').count();
  console.log('Total groups on page:', totalGroups, totalGroups === 12 ? '✅' : '❌');
  
  let groupsWith4Slots = 0;
  for (let g = 0; g < 12; g++) {
    const slots = desktopPage.locator('.desktop-view .group-card').nth(g).locator('div[style*="display: flex"][style*="align-items: center"]');
    if (await slots.count() === 4) groupsWith4Slots++;
  }
  console.log('Groups with 4 slots:', groupsWith4Slots, '/12', groupsWith4Slots === 12 ? '✅' : '❌');
  
  await desktopPage.screenshot({ path: '/home/jsr12/.openclaw/workspace/desktop-final.png' });
  await mobilePage.screenshot({ path: '/home/jsr12/.openclaw/workspace/mobile-final.png' });
  console.log('Screenshots saved');
  
  await browser.close();
  console.log('\n=== CROSS-DEVICE TEST COMPLETE ===');
}

run().catch(e => console.error('FATAL:', e.message));
