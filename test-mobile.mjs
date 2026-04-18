#!/usr/bin/env node
import { chromium } from 'playwright';
const BASE = 'http://192.168.50.203:3470';
const SESSION = '994aece24f896423c89faaa852329a822f6df815e138c7b6542d8a3542c77e8d';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/pool/1/predict`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check what's actually visible
  const bodyText = await page.textContent('body');
  console.log('Body text (first 300):', bodyText?.trim().substring(0, 300));

  // Mobile cards
  const mobileCount = await page.locator('.mobile-view').count();
  const desktopCount = await page.locator('.desktop-view').count();
  console.log(`Mobile cards: ${mobileCount}, Desktop cards: ${desktopCount}`);

  // Get CSS of first mobile card
  const mobileCard = page.locator('.mobile-view').first();
  const css = await mobileCard.evaluate(el => {
    const s = getComputedStyle(el);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity };
  });
  console.log('First mobile card CSS:', JSON.stringify(css));

  // Button visibility
  const btns = page.locator('.mobile-view').first().locator('button');
  const btnCount = await btns.count();
  console.log(`Buttons in mobile view: ${btnCount}`);
  if (btnCount > 0) {
    const firstBtn = btns.first();
    const btnCss = await firstBtn.evaluate(el => {
      const s = getComputedStyle(el);
      return { display: s.display, visibility: s.visibility, opacity: s.opacity };
    });
    console.log('First button CSS:', JSON.stringify(btnCss));
    const box = await firstBtn.boundingBox();
    console.log('First button bounding box:', JSON.stringify(box));
  }

  // Check parent container
  const parentCss = await mobileCard.locator('> div').first().evaluate(el => {
    const s = getComputedStyle(el);
    return { display: s.display, visibility: s.visibility };
  });
  console.log('First child of mobile card CSS:', JSON.stringify(parentCss));

  await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/mobile-test.png' });
  console.log('Screenshot: /home/jsr12/.openclaw/workspace/mobile-test.png');

  await browser.close();
}
run().catch(e => console.error('FATAL:', e.message));
