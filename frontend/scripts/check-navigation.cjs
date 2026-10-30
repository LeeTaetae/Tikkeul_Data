const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const output = path.resolve('artifacts/navigation-check');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('requestfailed', request => errors.push(`${new URL(request.url()).origin}${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) { const url = new URL(response.url()); errors.push(`${response.status()} ${url.origin}${url.pathname}`); } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().replace(/appkey=[^&\s]+/g, 'appkey=REDACTED')); });
  const frames = [];
  if (!process.argv.includes('--waiting-only')) {
  await page.goto('http://localhost:8081/navigation?test=replay', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="img"] svg path[d^="M12 2.5"]', { timeout: 30000 });
  for (const [name, delay] of [['start', 500], ['turn', 17000], ['later', 23000]]) {
    await page.waitForTimeout(delay);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    frames.push(await page.evaluate((name) => {
      const rotated = [...document.querySelectorAll('div')].find(e => /translate\(-50%, -50%\) rotate/.test(e.style.transform));
      const marker = [...document.querySelectorAll('[role="img"]')].find(e => e.querySelector('svg path[d^="M12 2.5"]'));
      const r = marker?.getBoundingClientRect();
      const x = r ? r.x + r.width / 2 : null;
      const y = r ? r.y + r.height / 2 : null;
      const visible = r ? document.elementsFromPoint(x, y).some(e => e === marker || marker.contains(e)) : false;
      const errorOverlay = [...document.querySelectorAll('iframe')].some(e => /Uncaught Error|EMFILE/.test(e.contentDocument?.body?.innerText ?? '')) || /Uncaught Error|EMFILE|Bundling\.\.\./.test(document.body.innerText);
      return { name, rotation: rotated?.style.transform, marker: r ? { x, y, visible } : null, errorOverlay, text: document.body.innerText };
    }, name));
  }
  }
  await page.goto('http://localhost:8081/navigation?test=lowAccuracy', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('테스트 모드'), undefined, { timeout: 120000 });
  await page.waitForSelector('[role="img"] svg path[d^="M12 2.5"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(output, 'gps-waiting.png') });
  const waiting = await page.evaluate(() => ({ text: document.body.innerText, opacity: [...document.querySelectorAll('[role="img"]')].find(e => e.querySelector('svg path[d^="M12 2.5"]'))?.style.opacity }));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'landscape.png') });
  const passed = frames.every(f => f.marker?.visible && !f.errorOverlay && Math.abs(f.marker.x - 195) < 5)
    && (process.argv.includes('--waiting-only') || new Set(frames.map(f => f.rotation)).size > 1)
    && waiting.opacity === '0.55' && waiting.text.includes('출발지 미리보기') && errors.length === 0;
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed, frames, waiting, errors }, null, 2));
  console.log(JSON.stringify({ passed, frames, waiting, errors }, null, 2));
  await browser.close();
  if (!passed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
