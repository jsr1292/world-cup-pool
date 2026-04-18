#!/usr/bin/env node
import { chromium } from 'playwright';
const BASE = 'http://192.168.50.203:3470';
const POOL_ID = 1;
const SESSION = '994aece24f896423c89faaa852329a822f6df815e138c7b6542d8a3542c77e8d';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  await context.addCookies([{ name: 'session', value: SESSION, domain: '192.168.50.203', path: '/' }]);

  try {
    await page.goto(`${BASE}/pool/${POOL_ID}/predict`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const h1 = await page.textContent('h1').catch(() => 'NO_H1');
    const url = page.url();
    const bodySnippet = (await page.textContent('body').catch(() => '')).trim().substring(0, 150);

    console.log(`URL: ${url}`);
    console.log(`H1: "${h1}"`);
    console.log(`Body: ${bodySnippet}`);

    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    // Desktop check
    const desktopCards = await page.locator('.desktop-view').count();
    console.log(`Desktop cards: ${desktopCards}`);

    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-test.png' });
    console.log(`Screenshot saved`);
    if (errors.length) console.log('Errors:', errors.slice(0,3));

  } catch(err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/home/jsr12/.openclaw/workspace/dnd-test-err.png' }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    setTimeout(() => process.exit(0), 500);
  }
}

run();
