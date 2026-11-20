const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function captureScreenshots() {
  const repoPath = '/root/token-radar-01-entry';
  const outPath = path.join(repoPath, 'out');
  const screenshotsPath = path.join(repoPath, 'screenshots');
  
  // Run the model first to generate output
  console.log('Running model to generate output...');
  execSync(`cd ${repoPath} && MAKEFUN_OUTPUT_DIR=out node main.ts --input /root/token-radar-01-kit/input/snapshot.json`, { stdio: 'inherit' });
  
  // Create self-contained HTML
  console.log('Creating self-contained HTML...');
  execSync(`cd ${repoPath} && node create-self-contained.js`, { stdio: 'inherit' });
  
  const dashboardPath = path.join(outPath, 'dashboard', 'index-self-contained.html');
  if (!fs.existsSync(dashboardPath)) {
    console.error('Self-contained dashboard not found at', dashboardPath);
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  const fileUrl = 'file://' + dashboardPath;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  
  // Wait for the board element to have content
  await page.waitForFunction(() => {
    const board = document.getElementById('board');
    return board && board.innerHTML.length > 100;
  }, { timeout: 30000 });
  console.log('Board has content');
  
  // Screenshot 1: Board view (viewport only, not full page)
  await page.screenshot({ path: path.join(screenshotsPath, '1-board.png'), fullPage: false });
  console.log('Captured 1-board.png');
  
  // Wait for table rows
  await page.waitForSelector('tbody tr', { timeout: 30000 });
  console.log('Table rows found');
  
  // Screenshot 2: Detail view
  await page.locator('tbody tr').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(screenshotsPath, '2-detail.png'), fullPage: false });
  console.log('Captured 2-detail.png');
  
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  
  // Screenshot 3: Filtered view
  await page.fill('#q', 'lending');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsPath, '3-filtered.png'), fullPage: false });
  console.log('Captured 3-filtered.png');
  
  await browser.close();
  console.log('All screenshots captured!');
  
  // Copy screenshots to out/ as well
  fs.cpSync(screenshotsPath, path.join(outPath, 'screenshots'), { recursive: true });
  console.log('Screenshots copied to out/');
}

captureScreenshots().catch(err => {
  console.error(err);
  process.exit(1);
});