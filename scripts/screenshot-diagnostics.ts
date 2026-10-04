import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1024],
    ['mobile', 390, 844],
  ] as const) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: name === 'mobile',
      hasTouch: name === 'mobile',
    });
    await page.goto(process.env.PREVIEW_URL ?? 'http://127.0.0.1:4175');
    await page.getByText('Local model ready', { exact: true }).waitFor();
    await page.getByLabel('Choose an image file').setInputFiles('e2e/fixtures/sea-640x480.jpg');
    await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
    await page.getByTestId('recognition-result').waitFor();
    await page.getByRole('button', { name: 'Analysis details', exact: true }).click();
    await page.getByRole('dialog', { name: 'Analysis details' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(`../docs/lab1/figures/${name}-details.png`) });
    await page.getByText('Model SHA-256', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(`../docs/lab1/figures/${name}-model-hash.png`) });
    if (
      await page
        .getByRole('dialog')
        .evaluate((element) => element.scrollWidth > element.clientWidth)
    ) {
      throw new Error('Diagnostic dialog overflows horizontally.');
    }
    if (name === 'mobile') {
      await page.getByRole('region', { name: 'Model reliability' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve('../docs/lab1/figures/mobile-reliability.png') });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
