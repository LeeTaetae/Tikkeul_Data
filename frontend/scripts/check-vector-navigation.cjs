const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
(async () => {
  const out = 'artifacts/navigation-check';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => errors.push(new URL(r.url()).origin + ': ' + r.failure()?.errorText));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).origin}${new URL(r.url()).pathname}`); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.goto(`${process.env.NAVIGATION_TEST_URL || 'http://localhost:8081'}/navigation?test=city`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-navigation-marker]', { timeout: 60000 }).catch(async e => {
    await page.screenshot({ path: `${out}/vector-error.png` });
    console.error(JSON.stringify({ text: await page.locator('body').innerText(), errors }));
    throw e;
  });
  await page.waitForTimeout(3000);
  const inspect = () => page.evaluate(() => {
    const map = document.querySelector('[data-navigation-map]');
    const marker = document.querySelector('[data-navigation-marker]');
    const rect = marker?.getBoundingClientRect();
    return { camera: { ...map?.dataset }, marker: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null, text: document.body.innerText };
  });
  const start = await inspect();
  await page.screenshot({ path: `${out}/vector-mobile.png` });
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await page.waitForTimeout(1500);
  const zoomed = await inspect();
  await page.waitForTimeout(1500);
  const zoomPersists = await inspect();
  await page.getByRole('button', { name: '지도 축소', exact: true }).click();
  await page.waitForTimeout(38000);
  const turn = await inspect();
  await page.screenshot({ path: `${out}/vector-turn.png` });
  await page.setViewportSize({ width: 1167, height: 860 });
  await page.waitForTimeout(1500);
  const desktop = await inspect();
  await page.screenshot({ path: `${out}/vector-desktop.png` });
  const passed = errors.length === 0 && start.marker && turn.marker && desktop.marker && Number(start.camera.pitch) === 0 && Math.abs(Number(start.camera.bearing) - Number(turn.camera.bearing)) > 10
    && Number(zoomed.camera.zoom) > Number(start.camera.zoom) && Number(zoomPersists.camera.zoom) === Number(zoomed.camera.zoom);
  const result = { passed: !!passed, start, zoomed, zoomPersists, turn, desktop, errors };
  fs.writeFileSync(`${out}/vector-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!passed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
