const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  
  // Register via API
  const regPage = await context.newPage();
  await regPage.goto('http://localhost:3470/register');
  await regPage.waitForLoadState('networkidle').catch(() => {});
  
  // Register via API call
  const testUser = `brr2_${Date.now()}`;
  await regPage.evaluate(async (u) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: u, password: 'test1234', display_name: 'Browser Test'})
    });
    return r.json();
  }, testUser);
  
  // Join pool 8 via API
  await regPage.evaluate(async () => {
    const r = await fetch('/api/pools/join', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: '4-RCY8Y0'})
    });
    return r.json();
  });

  const pages = [
    { path: '/' },
    { path: '/pools' },
    { path: '/pools/create' },
    { path: '/pool/8' },
    { path: '/pool/8/predict' },
    { path: '/pool/8/bracket' },
    { path: '/pool/8/admin' },
    { path: '/join' },
    { path: '/profile' },
  ];

  const results = [];
  
  for (const pageInfo of pages) {
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    
    page.on('pageerror', e => errors.push(`PageError: ${e.message}`));
    page.on('requestfailed', r => failedRequests.push(`${r.url().slice(-50)} - ${r.failure()?.errorText}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`Console: ${msg.text().slice(0, 100)}`);
    });
    
    try {
      const response = await page.goto(`http://localhost:3470${pageInfo.path}`, { 
        waitUntil: 'networkidle', timeout: 10000 
      }).catch(e => null);
      
      const status = response?.status?.() || 0;
      const url = page.url();
      await page.waitForTimeout(1000);
      
      // Desktop: check overflow
      const desktopOverflow = await page.evaluate(() => {
        return document.body.scrollWidth > window.innerWidth;
      });
      
      // Mobile: check overflow
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);
      const mobileWidth = await page.evaluate(() => document.body.scrollWidth);
      
      const icon = (errors.length === 0 && failedRequests.length === 0) ? '✅' : '⚠️';
      let msg = `${icon} ${pageInfo.path} → ${url.replace('http://localhost:3470', '')} (${status})`;
      if (desktopOverflow) msg += ' [DESKTOP-OVERFLOW]';
      if (mobileWidth > 375) msg += ` [MOBILE-OVERFLOW: ${mobileWidth}px]`;
      if (errors.length) msg += ` ERRORS: ${errors.slice(0,3).join('; ')}`;
      if (failedRequests.length) msg += ` FAILS: ${failedRequests.length}`;
      results.push(msg);
    } catch (e) {
      results.push(`❌ ${pageInfo.path}: ${e.message.slice(0, 150)}`);
    }
    await page.close();
  }

  console.log('\n=== Browser Audit ===');
  results.forEach(r => console.log(r));
  await browser.close();
})();
