// Browser audit using Playwright with Chromium
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const pages = [
    { path: '/', expectRedirect: true },
    { path: '/pools', needAuth: true },
    { path: '/pools/create', needAuth: true },
    { path: '/pool/8', needAuth: true },
    { path: '/pool/8/predict', needAuth: true },
    { path: '/pool/8/bracket', needAuth: true },
    { path: '/pool/8/admin', needAuth: true },
    { path: '/join', needAuth: true },
    { path: '/profile', needAuth: true },
  ];

  // Login first to get auth cookie
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const loginPage = await context.newPage();
  
  // Register a test user
  const testUser = `browser_r2_${Date.now()}`;
  await loginPage.goto('http://localhost:3470/register');
  await loginPage.waitForLoadState('networkidle').catch(() => {});
  
  await loginPage.fill('input[name="username"], input[type="text"]', testUser).catch(() => {});
  // Try to find input fields
  const inputs = await loginPage.$$('input');
  if (inputs.length >= 3) {
    await inputs[0].fill(testUser);
    await inputs[1].fill('test1234');
    await inputs[2].fill('Browser Test');
    await loginPage.click('button[type="submit"], button').catch(() => {});
    await loginPage.waitForTimeout(2000);
  }
  
  console.log('Auth page URL:', loginPage.url());

  // Join pool 8
  const joinPage = await context.newPage();
  const joinErrors = [];
  joinPage.on('pageerror', e => joinErrors.push(e.message));
  
  await joinPage.goto('http://localhost:3470/join');
  await joinPage.waitForLoadState('networkidle').catch(() => {});
  
  // Try to fill invite code and join
  const joinInputs = await joinPage.$$('input');
  if (joinInputs.length > 0) {
    await joinInputs[0].fill('4-RCY8Y0');
    await joinPage.click('button').catch(() => {});
    await joinPage.waitForTimeout(2000);
  }
  
  console.log('After join URL:', joinPage.url());

  // Test each page
  const results = [];
  
  for (const pageInfo of pages) {
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    
    page.on('pageerror', e => errors.push(`PageError: ${e.message}`));
    page.on('requestfailed', r => failedRequests.push(`${r.url()} - ${r.failure()?.errorText}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`);
    });
    
    try {
      const response = await page.goto(`http://localhost:3470${pageInfo.path}`, { 
        waitUntil: 'networkidle',
        timeout: 10000 
      }).catch(e => ({ status: () => 0, error: e.message }));
      
      const status = response?.status?.() || 0;
      const url = page.url();
      
      // Check for JS errors
      await page.waitForTimeout(1000);
      
      // Desktop viewport check
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const hOverflow = bodyWidth > viewportWidth;
      
      // Mobile viewport check
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);
      const mobileWidth = await page.evaluate(() => document.body.scrollWidth);
      const mobileOverflow = mobileWidth > 375;
      
      const ok = errors.length === 0 && failedRequests.length === 0;
      const icon = ok ? '✅' : '⚠️';
      let msg = `${icon} ${pageInfo.path} → ${url.replace('http://localhost:3470', '')} (HTTP ${status})`;
      if (hOverflow) msg += ` [DESKTOP H-OVERFLOW: ${bodyWidth}px]`;
      if (mobileOverflow) msg += ` [MOBILE H-OVERFLOW: ${mobileWidth}px]`;
      if (errors.length > 0) msg += ` [${errors.length} errors: ${errors.slice(0,2).join('; ')}]`;
      if (failedRequests.length > 0) msg += ` [${failedRequests.length} failed requests]`;
      
      results.push(msg);
    } catch (e) {
      results.push(`❌ ${pageInfo.path}: ${e.message.slice(0, 100)}`);
    }
    
    await page.close();
  }

  console.log('\n=== Browser Audit Results ===');
  results.forEach(r => console.log(r));

  await browser.close();
})();
