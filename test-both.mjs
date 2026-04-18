#!/usr/bin/env node
/**
 * Test both desktop drag and mobile tap on SAME session
 */
import { chromium } from 'playwright';

const BASE = 'http://192.168.50.203:3470';
const POOL_ID = 1;
const SESSION = '994aece24f896423c89faaa852329a822f6df815e138c7b6542d8a3542c77e8d';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await context.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

  try {
    // ─── DESKTOP TEST ───────────────────────────────────────────────────
    console.log('=== DESKTOP TEST ===');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/pool/${POOL_ID}/predict`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check groups visible
    const desktopCards = await page.locator('.desktop-view').count();
    console.log(`Desktop cards: ${desktopCards}`);

    // Check items in Group A
    const slotRows = page.locator('.desktop-view').first().locator('[draggable="true"]');
    const draggableCount = await slotRows.count();
    console.log(`Draggable items in Group A: ${draggableCount}`);

    if (draggableCount > 0) {
      const texts = await slotRows.allTextContents();
      console.log(`Before drag: ${JSON.stringify(texts.map(t => t.trim().substring(0, 20)))}`);

      // Drag first draggable to second position
      const r0 = slotRows.nth(0);
      const r1 = slotRows.nth(1);
      const b0 = await r0.boundingBox();
      const b1 = await r1.boundingBox();
      console.log(`Dragging from y=${Math.round(b0.y)} to y=${Math.round(b1.y)}`);
      await page.mouse.move(b0.x + b0.width/2, b0.y + b0.height/2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(b1.x + b1.width/2, b1.y + b1.height/2, { steps: 10 });
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.waitForTimeout(2000);

      const textsAfter = await slotRows.allTextContents();
      console.log(`After drag: ${JSON.stringify(textsAfter.map(t => t.trim().substring(0, 20)))}`);
      console.log(`Order changed: ${texts[0]?.trim() !== textsAfter[0]?.trim()}`);
    }

    // ─── MOBILE TEST ───────────────────────────────────────────────────
    console.log('\n=== MOBILE TEST ===');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const mobileCards = await page.locator('.mobile-view').count();
    console.log(`Mobile cards: ${mobileCards}`);

    if (mobileCards > 0) {
      // Check buttons in first mobile group
      const buttons = page.locator('.mobile-view').first().locator('button');
      const btnCount = await buttons.count();
      console.log(`Tap buttons in Group A: ${btnCount} (should be 16 = 4 teams × 4 positions)`);

      if (btnCount >= 4) {
        // Get team names
        const teamRows = page.locator('.mobile-view').first().locator('[style*="rgba(201,168,76"]');
        const teamCount = await teamRows.count();
        console.log(`Team rows with selection highlight: ${teamCount}`);

        // Tap button[0] (position 1 for first team)
        const firstBtn = buttons.nth(0);
        const btnText = await firstBtn.textContent();
        console.log(`Tapping button[0]: "${btnText}"`);
        await firstBtn.click();
        await page.waitForTimeout(1000);

        // Check if selection changed
        const teamRowsAfter = page.locator('.mobile-view').first().locator('[style*="rgba(201,168,76"]');
        const teamCountAfter = await teamRowsAfter.count();
        console.log(`Highlighted rows after tap: ${teamCountAfter}`);
      }
    }

    // ─── CHECK STATE ─────────────────────────────────────────────────
    console.log('\n=== CHECK SAVED STATE ===');
    // Wait for auto-save
    await page.waitForTimeout(1000);

    if (errors.length > 0) {
      console.log('Errors:', errors.slice(0, 5));
    } else {
      console.log('No errors');
    }

    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-both-test.png', fullPage: false });
    console.log('Screenshot: /home/jsr12/.openclaw/workspace/dnd-both-test.png');

  } catch (err) {
    console.error('FATAL:', err.message);
    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-both-test-err.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
