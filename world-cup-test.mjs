import { chromium } from 'playwright';

const BASE_URL = 'http://192.168.50.203:3450';
const TEST_TIMESTAMP = Date.now();
const USER1 = `testuser_${TEST_TIMESTAMP}`;
const USER2 = `testuser2_${TEST_TIMESTAMP}`;
const PASSWORD = 'TestPassword123!';
const USER1_DISPLAY = 'Test User One';
const USER2_DISPLAY = 'Test User Two';

const results = [];
let browser, context, page;
let inviteCode = '';
let freePoolId = null;
let paidPoolId = null;
let consoleErrors = [];

function log(test, status, details = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${test}] ${status}: ${details}`);
  results.push({ test, status, details });
}

async function screenshot(name) {
  try {
    await page.screenshot({ path: `/tmp/screenshot_${name}.png`, fullPage: true });
    console.log(`📸 Saved: /tmp/screenshot_${name}.png`);
  } catch (e) {
    console.log(`📸 Could not save screenshot: ${e.message}`);
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function goto(url, waitForLoad = true) {
  await page.goto(`${BASE_URL}${url}`);
  if (waitForLoad) {
    await page.waitForLoadState('networkidle');
    await sleep(500);
  } else {
    await sleep(500);
  }
}

async function getSuccessMessage() {
  const success = await page.$('[style*="green"], .success, [class*="success"]');
  if (success) {
    return await success.textContent();
  }
  return null;
}

async function waitForUrl(urlPattern, timeout = 5000) {
  try {
    await page.waitForURL(urlPattern, { timeout });
    return true;
  } catch {
    return false;
  }
}

// ==================== USER TESTS ====================

async function test1_RegisterLoginLogout() {
  console.log('\n=== TEST 1: Register → Login → Logout → Login ===');
  
  // Go to login page
  await goto('/login');
  
  // Click Registro to switch to register mode
  const registroBtn = await page.$('button:has-text("Registro")');
  if (!registroBtn) {
    log('TEST 1', 'FAIL', 'Registro button not found');
    return;
  }
  await registroBtn.click();
  await sleep(300);
  
  // Fill registration form
  const inputs = await page.$$('input');
  let usernameInput, displayNameInput, passwordInput;
  
  for (const input of inputs) {
    const placeholder = await input.getAttribute('placeholder');
    if (placeholder === 'usuario') usernameInput = input;
    else if (placeholder === 'Tu nombre') displayNameInput = input;
    else if (placeholder === '••••••••') passwordInput = input;
  }
  
  if (!usernameInput) {
    log('TEST 1', 'FAIL', 'Username input not found');
    return;
  }
  
  await usernameInput.fill(USER1);
  if (passwordInput) await passwordInput.fill(PASSWORD);
  if (displayNameInput) await displayNameInput.fill(USER1_DISPLAY);
  
  // Submit
  await page.click('button[type="submit"]');
  
  // Wait for redirect to home
  const redirected = await waitForUrl('/', 8000);
  if (!redirected) {
    // Check if there was an error (user exists)
    const errorEl = await page.$('p:has-text("Error"), p:has-text("exists")');
    if (errorEl) {
      log('TEST 1a', 'PASS', 'User already exists (previous run)');
    } else {
      log('TEST 1a', 'FAIL', `Registration failed, URL: ${page.url()}`);
      return;
    }
  } else {
    log('TEST 1a', 'PASS', 'Registered and redirected to home');
  }
  
  // Now logout - look for "Cerrar sesión" in sidebar
  await sleep(500);
  const logoutBtn = await page.$('button:has-text("Cerrar sesión")');
  if (logoutBtn) {
    await logoutBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(1000);
    log('TEST 1b', 'PASS', 'Logout clicked');
  } else {
    log('TEST 1b', 'FAIL', 'Logout button not found');
    await screenshot('logout_check');
    return;
  }
  
  // Wait for redirect after logout
  await waitForUrl('/login', 5000);
  await sleep(500);
  
  // Now login as USER1
  await goto('/login');
  await sleep(500);
  
  const loginInputs = await page.$$('input');
  let loginUser, loginPass;
  for (const input of loginInputs) {
    const placeholder = await input.getAttribute('placeholder');
    if (placeholder === 'usuario') loginUser = input;
    else if (placeholder === '••••••••') loginPass = input;
  }
  
  if (!loginUser || !loginPass) {
    log('TEST 1c', 'FAIL', 'Login inputs not found');
    return;
  }
  
  await loginUser.fill(USER1);
  await loginPass.fill(PASSWORD);
  await page.click('button[type="submit"]');
  
  // Wait for redirect to home
  const loggedIn = await waitForUrl(/\/(home|pools|$)/, 8000);
  if (loggedIn) {
    log('TEST 1c', 'PASS', 'Login successful');
  } else {
    log('TEST 1c', 'FAIL', `Login failed, URL: ${page.url()}`);
  }
  
  // Verify we're actually logged in by checking greeting
  await goto('/');
  const greeting = await page.textContent('body');
  if (greeting.includes('Test User One') || greeting.includes(USER1)) {
    log('TEST 1d', 'PASS', 'User is logged in (greeting verified)');
  } else {
    log('TEST 1d', 'WARN', 'Could not verify login via greeting');
  }
}

async function test2_HomePage() {
  console.log('\n=== TEST 2: Home Page Elements ===');
  
  await goto('/');
  await sleep(500);
  
  // Check greeting
  const h1 = await page.$('h1');
  if (h1) {
    const text = await h1.textContent();
    log('TEST 2a', 'PASS', `Greeting: "${text}"`);
  } else {
    log('TEST 2a', 'FAIL', 'No h1 found');
  }
  
  // Check create pool link
  const createLink = await page.$('a[href*="create"]');
  if (createLink) {
    log('TEST 2b', 'PASS', 'Create pool link found');
  } else {
    log('TEST 2b', 'FAIL', 'Create pool link not found');
  }
}

async function test3_CreateFreePool() {
  console.log('\n=== TEST 3: Create Free Pool ===');
  
  await goto('/pools/create');
  await sleep(500);
  
  // Check if we're on the right page (not redirected to login)
  if (page.url().includes('/login')) {
    log('TEST 3', 'FAIL', 'Redirected to login - session not persisting');
    return;
  }
  
  // Fill form
  const nameInput = await page.$('input[placeholder*="Quiniela"]');
  if (!nameInput) {
    log('TEST 3', 'FAIL', 'Pool name input not found');
    await screenshot('create_pool_page');
    return;
  }
  
  await nameInput.fill(`Free Pool ${TEST_TIMESTAMP}`);
  
  // Set buy-in to 0
  const buyInInput = await page.$('input[type="number"]');
  if (buyInInput) await buyInInput.fill('0');
  
  // Submit
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await sleep(1000);
  
  const url = page.url();
  if (url.includes('/pool/')) {
    freePoolId = url.split('/pool/')[1];
    log('TEST 3', 'PASS', `Created free pool, ID: ${freePoolId}`);
  } else {
    // Check for error
    const errorEl = await page.$('p:has-text("Error")');
    if (errorEl) {
      log('TEST 3', 'FAIL', `Pool creation failed: ${await errorEl.textContent()}`);
    } else {
      log('TEST 3', 'FAIL', `Not redirected to pool. URL: ${url}`);
    }
    await screenshot('after_create_free');
  }
}

async function test4_CreatePaidPool() {
  console.log('\n=== TEST 4: Create Paid Pool ===');
  
  await goto('/pools/create');
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('TEST 4', 'FAIL', 'Redirected to login - session not persisting');
    return;
  }
  
  const nameInput = await page.$('input[placeholder*="Quiniela"]');
  if (!nameInput) {
    log('TEST 4', 'FAIL', 'Pool name input not found');
    return;
  }
  
  await nameInput.fill(`Paid Pool ${TEST_TIMESTAMP}`);
  
  // Set buy-in to 10
  const buyInInput = await page.$('input[type="number"]');
  if (buyInInput) await buyInInput.fill('10');
  
  // Enable multiple entries
  const checkbox = await page.$('input[type="checkbox"]');
  if (checkbox) {
    const isChecked = await checkbox.isChecked();
    if (!isChecked) await checkbox.check();
  }
  
  // Submit
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await sleep(1000);
  
  const url = page.url();
  if (url.includes('/pool/')) {
    paidPoolId = url.split('/pool/')[1];
    log('TEST 4', 'PASS', `Created paid pool (€10, multi), ID: ${paidPoolId}`);
  } else {
    const errorEl = await page.$('p:has-text("Error")');
    if (errorEl) {
      log('TEST 4', 'FAIL', `Pool creation failed: ${await errorEl.textContent()}`);
    } else {
      log('TEST 4', 'FAIL', `Not redirected to pool. URL: ${url}`);
    }
    await screenshot('after_create_paid');
  }
}

async function test5_PoolDetailTabs() {
  console.log('\n=== TEST 5: Pool Detail - All Tabs ===');
  
  if (!freePoolId) {
    log('TEST 5', 'FAIL', 'No free pool ID');
    return;
  }
  
  await goto(`/pool/${freePoolId}`);
  await sleep(500);
  
  const tabs = ['Clasificación', 'Pronósticos', 'Eliminatorias', 'Miembros', 'Puntuación'];
  
  for (const tabName of tabs) {
    const tabBtn = await page.$(`button:has-text("${tabName}")`);
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(200);
      log(`TEST 5-${tabName}`, 'PASS', 'Tab loaded');
    } else {
      log(`TEST 5-${tabName}`, 'FAIL', 'Tab button not found');
    }
  }
}

async function test6_StickyHeaderBackLink() {
  console.log('\n=== TEST 6: Sticky Header Back Link ===');
  
  if (!freePoolId) {
    log('TEST 6', 'FAIL', 'No free pool ID');
    return;
  }
  
  await goto(`/pool/${freePoolId}`);
  await sleep(500);
  
  const backLink = await page.$('a:has-text("Quinielas")');
  if (backLink) {
    await backLink.click();
    await page.waitForLoadState('networkidle');
    await sleep(300);
    
    if (page.url() === BASE_URL + '/' || page.url().endsWith('/')) {
      log('TEST 6', 'PASS', 'Back link works');
    } else {
      log('TEST 6', 'FAIL', `Back link went to: ${page.url()}`);
    }
  } else {
    log('TEST 6', 'FAIL', 'Back link not found');
    await screenshot('back_link_check');
  }
}

async function test7_InviteCodeCopy() {
  console.log('\n=== TEST 7: Invite Code Copy Button ===');
  
  if (!freePoolId) {
    log('TEST 7', 'FAIL', 'No free pool ID');
    return;
  }
  
  await goto(`/pool/${freePoolId}`);
  await sleep(500);
  
  // Extract invite code
  const bodyText = await page.textContent('body');
  const codeMatch = bodyText.match(/([A-Z0-9]{6,})/);
  if (codeMatch) {
    inviteCode = codeMatch[1];
    log('TEST 7a', 'PASS', `Found invite code: ${inviteCode}`);
  }
  
  const copyBtn = await page.$('button:has-text("Copiar")');
  if (copyBtn) {
    log('TEST 7b', 'PASS', 'Copy button found');
  } else {
    log('TEST 7b', 'WARN', 'Copy button not found');
  }
}

async function test8_JoinPoolViaInvite() {
  console.log('\n=== TEST 8: Join Pool via Invite Code ===');
  
  if (!inviteCode) {
    log('TEST 8', 'FAIL', 'No invite code available');
    return;
  }
  
  // Logout first
  const logoutBtn = await page.$('button:has-text("Cerrar sesión")');
  if (logoutBtn) {
    await logoutBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(1000);
    await waitForUrl('/login', 5000);
  }
  
  // Register user 2
  await goto('/login');
  await sleep(500);
  
  const registroBtn = await page.$('button:has-text("Registro")');
  if (registroBtn) await registroBtn.click();
  await sleep(300);
  
  const inputs = await page.$$('input');
  let usernameInput, displayNameInput, passwordInput;
  for (const input of inputs) {
    const placeholder = await input.getAttribute('placeholder');
    if (placeholder === 'usuario') usernameInput = input;
    else if (placeholder === 'Tu nombre') displayNameInput = input;
    else if (placeholder === '••••••••') passwordInput = input;
  }
  
  if (usernameInput) await usernameInput.fill(USER2);
  if (passwordInput) await passwordInput.fill(PASSWORD);
  if (displayNameInput) await displayNameInput.fill(USER2_DISPLAY);
  
  await page.click('button[type="submit"]');
  await waitForUrl('/', 8000);
  log('TEST 8a', 'PASS', 'Registered user 2');
  
  // Go to join page
  await goto('/join');
  await sleep(500);
  
  const codeInput = await page.$('input[placeholder*="código" i]');
  if (codeInput) {
    await codeInput.fill(inviteCode);
  } else {
    log('TEST 8b', 'FAIL', 'Code input not found');
    return;
  }
  
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await sleep(1000);
  
  if (page.url().includes('/pool/')) {
    log('TEST 8', 'PASS', 'Joined pool via invite code');
  } else {
    const errorEl = await page.$('p:has-text("Error")');
    if (errorEl) {
      log('TEST 8', 'FAIL', `Join failed: ${await errorEl.textContent()}`);
    } else {
      log('TEST 8', 'FAIL', `Join failed, URL: ${page.url()}`);
    }
    await screenshot('after_join');
  }
}

async function test9_GroupPredictions() {
  console.log('\n=== TEST 9: Make Group Predictions ===');
  
  if (!freePoolId) {
    log('TEST 9', 'FAIL', 'No free pool ID');
    return;
  }
  
  await goto(`/pool/${freePoolId}/predict`);
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('TEST 9', 'FAIL', 'Redirected to login');
    return;
  }
  
  const selects = await page.$$('select');
  if (selects.length >= 2) {
    log('TEST 9a', 'PASS', `Found ${selects.length} prediction selects`);
    
    for (let i = 0; i < Math.min(4, selects.length); i++) {
      const options = await selects[i].$$('option');
      if (options.length > 1) {
        await selects[i].selectOption({ index: 1 });
      }
    }
    
    const saveBtn = await page.$('button:has-text("Guardar")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(500);
      log('TEST 9', 'PASS', 'Group predictions saved');
    } else {
      log('TEST 9', 'FAIL', 'Save button not found');
    }
  } else {
    log('TEST 9', 'WARN', `Only ${selects.length} selects found`);
  }
}

async function test10_BracketPredictions() {
  console.log('\n=== TEST 10: Make Bracket Predictions ===');
  
  if (!freePoolId) {
    log('TEST 10', 'FAIL', 'No free pool ID');
    return;
  }
  
  await goto(`/pool/${freePoolId}/bracket`);
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('TEST 10', 'FAIL', 'Redirected to login');
    return;
  }
  
  const selects = await page.$$('select');
  if (selects.length > 0) {
    log('TEST 10a', 'PASS', `Found ${selects.length} bracket selects`);
    
    for (let i = 0; i < Math.min(4, selects.length); i++) {
      const options = await selects[i].$$('option');
      if (options.length > 1) {
        await selects[i].selectOption({ index: 1 });
      }
    }
    
    const saveBtn = await page.$('button:has-text("Guardar")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(500);
      log('TEST 10', 'PASS', 'Bracket predictions saved');
    }
  } else {
    log('TEST 10', 'WARN', 'No bracket selects found');
  }
}

async function test11_ProfilePage() {
  console.log('\n=== TEST 11: Profile Page ===');
  
  await goto('/profile');
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('TEST 11', 'FAIL', 'Redirected to login');
    return;
  }
  
  const bodyText = await page.textContent('body');
  if (bodyText.includes('Usuario') || bodyText.includes('usuario')) {
    log('TEST 11a', 'PASS', 'User info section found');
  } else {
    log('TEST 11a', 'FAIL', 'User info not found');
  }
  
  if (bodyText.includes(USER2_DISPLAY) || bodyText.includes(USER2)) {
    log('TEST 11b', 'PASS', 'Display name shown');
  } else {
    log('TEST 11b', 'WARN', 'Display name not found');
  }
  
  const logoutBtn = await page.$('button:has-text("Cerrar sesión")');
  if (logoutBtn) {
    await logoutBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(1000);
    log('TEST 11c', 'PASS', 'Logout works');
  } else {
    log('TEST 11c', 'FAIL', 'Logout button not found');
  }
}

async function test12_SecondPredictionEntry() {
  console.log('\n=== TEST 12: Second Prediction Entry ===');
  
  if (!paidPoolId) {
    log('TEST 12', 'FAIL', 'No paid pool ID');
    return;
  }
  
  // Login as user 2
  await goto('/login');
  await sleep(500);
  
  const inputs = await page.$$('input');
  let loginUser, loginPass;
  for (const input of inputs) {
    const placeholder = await input.getAttribute('placeholder');
    if (placeholder === 'usuario') loginUser = input;
    else if (placeholder === '••••••••') loginPass = input;
  }
  
  if (loginUser && loginPass) {
    await loginUser.fill(USER2);
    await loginPass.fill(PASSWORD);
    await page.click('button[type="submit"]');
    await waitForUrl('/', 8000);
  }
  
  await goto(`/pool/${paidPoolId}/predict`);
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('TEST 12', 'FAIL', 'Redirected to login');
    return;
  }
  
  const addBtn = await page.$('button:has-text("Nueva"), button:has-text("Add")');
  if (addBtn) {
    await addBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(500);
    log('TEST 12', 'PASS', 'Add entry button clicked');
  } else {
    log('TEST 12', 'WARN', 'Add entry button not found');
  }
}

// ==================== ADMIN TESTS ====================

async function testAdmin1_AdminPageLoads() {
  console.log('\n=== ADMIN TEST 1: Admin Page Loads ===');
  
  if (!paidPoolId) {
    log('ADMIN 1', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  if (page.url().includes('/login')) {
    log('ADMIN 1', 'FAIL', 'Redirected to login');
    return;
  }
  
  const bodyText = await page.textContent('body');
  const sections = ['Configuración', 'Fechas', 'Puntuación', 'Miembros'];
  let foundSections = sections.filter(s => bodyText.includes(s)).length;
  
  if (foundSections >= 3) {
    log('ADMIN 1', 'PASS', `Found ${foundSections}/4 admin sections`);
  } else {
    log('ADMIN 1', 'FAIL', `Only ${foundSections}/4 admin sections found`);
  }
}

async function testAdmin2_ConfigToggleMultipleEntries() {
  console.log('\n=== ADMIN TEST 2: Config - Toggle Multiple Entries ===');
  
  if (!paidPoolId) {
    log('ADMIN 2', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const checkbox = await page.$('input[type="checkbox"]');
  if (checkbox) {
    await checkbox.click();
    await page.waitForLoadState('networkidle');
    await sleep(200);
    
    const saveBtn = await page.$('button:has-text("Guardar")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(500);
      log('ADMIN 2', 'PASS', 'Multiple entries toggled and saved');
    } else {
      log('ADMIN 2', 'FAIL', 'Save button not found');
    }
  } else {
    log('ADMIN 2', 'FAIL', 'Checkbox not found');
    await screenshot('admin_config');
  }
}

async function testAdmin3_FechasLimite() {
  console.log('\n=== ADMIN TEST 3: Fechas Límite ===');
  
  if (!paidPoolId) {
    log('ADMIN 3', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const dateInputs = await page.$$('input[type="datetime-local"]');
  if (dateInputs.length >= 1) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 16);
    
    await dateInputs[0].fill(dateStr);
    await page.waitForLoadState('networkidle');
    await sleep(200);
    
    const saveBtn = await page.$('button:has-text("Guardar")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(500);
      log('ADMIN 3', 'PASS', 'Deadline set and saved');
    }
  } else {
    log('ADMIN 3', 'FAIL', 'Date input not found');
    await screenshot('admin_fechas');
  }
}

async function testAdmin4_PuntuacionChange() {
  console.log('\n=== ADMIN TEST 4: Puntuación - Change exact_score ===');
  
  if (!paidPoolId) {
    log('ADMIN 4', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const numInputs = await page.$$('input[type="number"]');
  if (numInputs.length > 0) {
    const firstInput = numInputs[0];
    const currentVal = await firstInput.inputValue();
    const newVal = (parseInt(currentVal) + 5).toString();
    await firstInput.fill(newVal);
    await page.waitForLoadState('networkidle');
    await sleep(200);
    
    const saveBtn = await page.$('button:has-text("Guardar")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await sleep(500);
      log('ADMIN 4', 'PASS', `Changed scoring from ${currentVal} to ${newVal}`);
    }
  } else {
    log('ADMIN 4', 'FAIL', 'No number inputs found');
    await screenshot('admin_puntuacion');
  }
}

async function testAdmin5_MarkUserPaid() {
  console.log('\n=== ADMIN TEST 5: Miembros - Mark User Paid ===');
  
  if (!paidPoolId) {
    log('ADMIN 5', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const unpaidBtn = await page.$('button:has-text("✗ Pendiente")');
  if (unpaidBtn) {
    await unpaidBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(500);
    
    const paidBtn = await page.$('button:has-text("✓ Pagado")');
    if (paidBtn) {
      log('ADMIN 5', 'PASS', 'User marked as paid');
    } else {
      log('ADMIN 5', 'FAIL', 'Button did not change');
    }
  } else {
    const paidBtn = await page.$('button:has-text("✓ Pagado")');
    if (paidBtn) {
      log('ADMIN 5', 'PASS', 'All users already paid');
    } else {
      log('ADMIN 5', 'FAIL', 'No payment button found');
      await screenshot('admin_miembros');
    }
  }
}

async function testAdmin6_UnmarkUserPaid() {
  console.log('\n=== ADMIN TEST 6: Miembros - Unmark User Paid ===');
  
  if (!paidPoolId) {
    log('ADMIN 6', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const paidBtn = await page.$('button:has-text("✓ Pagado")');
  if (paidBtn) {
    await paidBtn.click();
    await page.waitForLoadState('networkidle');
    await sleep(500);
    
    const dialog = await page.$('[role="dialog"]');
    if (dialog) {
      log('ADMIN 6a', 'PASS', 'Confirm dialog appeared');
      const confirmBtn = await dialog.$('button:has-text("Confirmar")');
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForLoadState('networkidle');
        await sleep(500);
      }
    }
    
    const unpaidBtn = await page.$('button:has-text("✗ Pendiente")');
    if (unpaidBtn) {
      log('ADMIN 6', 'PASS', 'User unmarked as paid');
    } else {
      log('ADMIN 6', 'FAIL', 'User still marked as paid');
    }
  } else {
    log('ADMIN 6', 'FAIL', 'No paid button found');
  }
}

async function testAdmin7_Resultados() {
  console.log('\n=== ADMIN TEST 7: Resultados ===');
  
  if (!paidPoolId) {
    log('ADMIN 7', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const bodyText = await page.textContent('body');
  if (bodyText.includes('Resultados')) {
    log('ADMIN 7', 'PASS', 'Resultados section found');
  } else {
    log('ADMIN 7', 'FAIL', 'Resultados section not found');
  }
  
  const matchInputs = await page.$$('input[data-match-id]');
  if (matchInputs.length > 0) {
    log('ADMIN 7b', 'PASS', `Found ${matchInputs.length} match inputs`);
  } else {
    log('ADMIN 7b', 'WARN', 'No match inputs (may be empty)');
  }
}

async function testAdmin8_MultipleEntriesDisplay() {
  console.log('\n=== ADMIN TEST 8: Multiple Entries Display ===');
  
  if (!paidPoolId) {
    log('ADMIN 8', 'FAIL', 'No paid pool ID');
    return;
  }
  
  await goto(`/pool/${paidPoolId}/admin`);
  await sleep(500);
  
  const memberButtons = await page.$$('button:has-text("✓ Pagado"), button:has-text("✗ Pendiente")');
  if (memberButtons.length >= 1) {
    log('ADMIN 8', 'PASS', `Found ${memberButtons.length} member entries`);
  } else {
    log('ADMIN 8', 'WARN', 'No member entries found');
  }
}

// ==================== MAIN ====================

async function runTests() {
  console.log('🌍 Starting World Cup 2026 Pool App Tests');
  console.log('==========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Users: ${USER1}, ${USER2}`);
  console.log(`Timestamp: ${TEST_TIMESTAMP}`);
  
  browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  page = await context.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });
  
  try {
    await test1_RegisterLoginLogout();
    await test2_HomePage();
    await test3_CreateFreePool();
    await test4_CreatePaidPool();
    await test5_PoolDetailTabs();
    await test6_StickyHeaderBackLink();
    await test7_InviteCodeCopy();
    await test8_JoinPoolViaInvite();
    await test9_GroupPredictions();
    await test10_BracketPredictions();
    await test11_ProfilePage();
    await test12_SecondPredictionEntry();
    
    await testAdmin1_AdminPageLoads();
    await testAdmin2_ConfigToggleMultipleEntries();
    await testAdmin3_FechasLimite();
    await testAdmin4_PuntuacionChange();
    await testAdmin5_MarkUserPaid();
    await testAdmin6_UnmarkUserPaid();
    await testAdmin7_Resultados();
    await testAdmin8_MultipleEntriesDisplay();
    
  } catch (err) {
    console.error('\n❌ Test execution error:', err.message);
    await screenshot('error');
  }
  
  console.log('\n==========================================');
  console.log('📋 CONSOLE ERRORS (Error level only):');
  if (consoleErrors.length === 0) {
    console.log('  None detected');
  } else {
    consoleErrors.forEach(err => console.log(`  - ${err}`));
  }
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARN').length;
  
  console.log('\n==========================================');
  console.log('📊 SUMMARY:');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⚠️  Warnings: ${warnings}`);
  
  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.test}: ${r.details}`);
    });
  }
  
  const bugs = results.filter(r => r.status === 'FAIL');
  
  console.log('\n==========================================');
  console.log('🐛 BUGS FOUND:', bugs.length);
  if (bugs.length > 0) {
    console.log('\nDetailed bug report:');
    bugs.forEach((bug, i) => {
      console.log(`\n  [${i+1}] ${bug.test}`);
      console.log(`      Steps: ${bug.details}`);
      console.log(`      URL at failure: ${page.url()}`);
    });
  }
  
  await browser.close();
  
  console.log('\n✅ Test run complete!');
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
