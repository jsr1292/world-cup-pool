#!/usr/bin/env node
/**
 * DnD Debug Test for Group Predictions
 * Tests drag-and-drop on desktop and logs what happens
 */
const { chromium } = require('playwright');

const BASE = 'http://192.168.50.203:3470';
const POOL_ID = 1;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Desktop viewport
  await page.setViewportSize({ width: 1280, height: 900 });

  // Capture console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

  try {
    // 1. Register a test user
    const user = `dnd_test_${Date.now()}`;
    console.log(`\n[1] Registering: ${user}`);
    const regRes = await page.evaluate(async (u) => {
      const r = await fetch(`${window.location.origin}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'TestPass123!' })
      });
      return { ok: r.ok, status: r.status, body: await r.text() };
    }, user);
    console.log(`    Register: ${regRes.ok ? 'OK' : 'FAIL'} (${regRes.status})`);

    // 2. Login
    console.log(`\n[2] Logging in...`);
    const loginRes = await page.evaluate(async (u) => {
      const r = await fetch(`${window.location.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'TestPass123!' })
      });
      return { ok: r.ok, status: r.status };
    }, user);
    console.log(`    Login: ${loginRes.ok ? 'OK' : 'FAIL'} (${loginRes.status})`);

    // 3. Navigate to predict page
    console.log(`\n[3] Navigating to predict page...`);
    await page.goto(`${BASE}/pool/${POOL_ID}/predict`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 4. Check if page loaded
    const pageTitle = await page.textContent('h1').catch(() => 'NOT FOUND');
    console.log(`    Page title: ${pageTitle}`);

    // 5. Check for group cards
    const groupCards = await page.locator('.desktop-view').count();
    console.log(`    Desktop group cards visible: ${groupCards}`);

    // 6. Check for DnD zones
    const dndZones = await page.locator('[data-dnd-zone]').count();
    console.log(`    DnD zones found: ${dndZones}`);

    // 7. Find team rows in first group
    const teamRows = await page.locator('.desktop-view .group-card').first().locator('> div:nth-child(2) > div').count();
    console.log(`    Items in first DnD zone: ${teamRows}`);

    // 8. Try to get text of first few items
    const firstItems = await page.locator('.desktop-view .group-card').first().locator('> div:nth-child(2) > div').allTextContents();
    console.log(`    First items: ${JSON.stringify(firstItems.slice(0, 3))}`);

    // 9. Try drag and drop on first two items
    console.log(`\n[4] Testing drag and drop...`);
    const desktopView = page.locator('.desktop-view').first();
    const items = desktopView.locator('> div:nth-child(2) > div');

    const itemCount = await items.count();
    console.log(`    Items found: ${itemCount}`);

    if (itemCount >= 2) {
      const item1 = items.nth(0);
      const item2 = items.nth(1);

      const text1Before = await item1.textContent();
      const text2Before = await item2.textContent();
      console.log(`    Before: item[0]="${text1Before?.trim().substring(0, 30)}" item[1]="${text2Before?.trim().substring(0, 30)}"`);

      // Drag item1 to position of item2
      const box1 = await item1.boundingBox();
      const box2 = await item2.boundingBox();

      if (box1 && box2) {
        console.log(`    Dragging from (${box1.x}, ${box1.y}) to (${box2.x}, ${box2.y})`);
        await item1.hover();
        await page.mouse.down();
        await page.waitForTimeout(300);
        await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 10 });
        await page.waitForTimeout(500);
        await page.mouse.up();
        await page.waitForTimeout(1000);

        // Check what happened
        const itemsAfter = await items.allTextContents();
        console.log(`    After drag: ${JSON.stringify(itemsAfter.slice(0, 3))}`);

        const item1After = await items.nth(0).textContent();
        console.log(`    Item at position 0 now: "${item1After?.trim().substring(0, 30)}"`);
      }
    }

    // 10. Report errors
    if (errors.length > 0) {
      console.log(`\n[5] Console errors:`);
      errors.forEach(e => console.log(`    ERROR: ${e}`));
    } else {
      console.log(`\n[5] No console errors!`);
    }

    // 11. Screenshot
    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-test.png', fullPage: false });
    console.log(`\n[6] Screenshot saved to /home/jsr12/.openclaw/workspace/dnd-test.png`);

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-test-error.png' });
  } finally {
    await browser.close();
  }
}

run();
