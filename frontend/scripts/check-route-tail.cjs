const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.NAVIGATION_TEST_URL || 'http://localhost:8081'}/navigation?test=city`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-navigation-marker]', { timeout: 60000 });
  const frames = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(550);
    const rect = await page.locator('[data-navigation-marker]').boundingBox();
    const png = await page.screenshot();
    const result = await page.evaluate(async ({ png, rect }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const centerX = Math.round(rect.x + rect.width / 2);
      const top = Math.ceil(rect.y + rect.height + 3);
      const height = Math.min(60, canvas.height - top);
      const pixels = context.getImageData(centerX - 6, top, 12, height).data;
      let bluePixelsBehindCar = 0;
      for (let p = 0; p < pixels.length; p += 4) {
        if (Math.abs(pixels[p] - 8) < 18 && Math.abs(pixels[p + 1] - 102) < 18 && pixels[p + 2] > 235) bluePixelsBehindCar++;
      }
      return { bluePixelsBehindCar, carCenterX: centerX, carBottomY: top - 3 };
    }, { png: png.toString('base64'), rect });
    frames.push(result);
    if (i === 11) fs.writeFileSync('artifacts/navigation-check/no-route-tail.png', png);
  }
  const passed = errors.length === 0 && frames.every(f => f.bluePixelsBehindCar === 0);
  const result = { passed, frames, errors };
  fs.writeFileSync('artifacts/navigation-check/route-tail-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!passed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
