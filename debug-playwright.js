const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const repoPath = '/root/token-radar-01-entry';
const outPath = path.join(repoPath, 'out');
const dashboardPath = path.join(outPath, 'dashboard', 'index.html');

async function debug() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const fileUrl = 'file://' + dashboardPath;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const content = await page.content();
  fs.writeFileSync(path.join(outPath, 'debug-page2.html'), content);
  console.log('Done');
  await browser.close();
}

debug().catch(err => {
  console.error(err);
  process.exit(1);
});