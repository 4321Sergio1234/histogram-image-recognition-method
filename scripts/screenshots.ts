import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const destination = path.resolve(root, '../docs/lab1/figures');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch();
const mappings: Record<string, { number: number; control: string }[]> = {};
async function capture(page: Page, name: string) {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
  if (await dismiss.isVisible()) {
    await dismiss.click();
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('.toast')!).opacity === '0',
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  mappings[name] = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select'),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !element.closest('dialog:not([open])') &&
          !element.disabled
        );
      })
      .sort((a, b) => {
        const x = a.getBoundingClientRect(),
          y = b.getBoundingClientRect();
        return Math.abs(x.top - y.top) > 15 ? x.top - y.top : x.left - y.left;
      });
    return controls.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const marker = document.createElement('span');
      marker.dataset.reportMarker = 'true';
      marker.textContent = String(index + 1);
      marker.style.cssText = `position:absolute;left:${Math.max(0, rect.left + scrollX - 7)}px;top:${rect.top + scrollY - 9}px;width:22px;height:22px;background:#ad421f;color:white;border:2px solid white;border-radius:50%;font:bold 12px/18px Arial;text-align:center;z-index:99999;box-shadow:0 1px 4px #0004;pointer-events:none;`;
      document.body.append(marker);
      return {
        number: index + 1,
        control:
          element.getAttribute('aria-label') ??
          (element.tagName === 'SELECT' ? 'Export format' : (element.textContent?.trim() ?? '')),
      };
    });
  });
  await page.screenshot({ path: path.join(destination, `${name}.png`), fullPage: true });
  await page.evaluate(() =>
    document.querySelectorAll('[data-report-marker]').forEach((element) => element.remove()),
  );
}
try {
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1024 },
    deviceScaleFactor: 1,
  });
  await desktop.goto(previewUrl);
  await desktop.getByRole('button', { name: 'Choose image', exact: true }).waitFor();
  await desktop.getByText('Local model ready', { exact: true }).waitFor();
  await capture(desktop, 'desktop-empty');
  await desktop
    .getByLabel('Choose an image file')
    .setInputFiles(path.join(root, 'e2e/fixtures/sea-640x480.jpg'));
  await desktop.getByRole('button', { name: 'Analyze image', exact: true }).waitFor();
  await capture(desktop, 'desktop-ready');
  await desktop.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await desktop.getByTestId('recognition-result').waitFor();
  await capture(desktop, 'desktop-result');
  await desktop.getByRole('button', { name: 'Analysis details', exact: true }).click();
  await desktop.getByRole('dialog', { name: 'Analysis details' }).waitFor();
  await desktop.screenshot({
    path: path.join(destination, 'desktop-details.png'),
    fullPage: false,
  });
  await desktop.getByRole('button', { name: 'Close dialog' }).first().click();
  await desktop.getByRole('button', { name: 'Analyze another image', exact: true }).click();
  await desktop
    .getByLabel('Choose an image file')
    .setInputFiles(path.resolve(root, '../docs/lab1/data/ood-inputs/col-montgenevre-2019.jpg'));
  await desktop.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await desktop.getByTestId('recognition-result').waitFor();
  await capture(desktop, 'desktop-unsupported');
  await desktop.getByRole('button', { name: 'Analyze another image', exact: true }).click();
  await desktop
    .getByLabel('Choose an image file')
    .setInputFiles(
      path.resolve(root, '../docs/lab3/data/inputs/stormy-sea-balnabruach-648595.jpg'),
    );
  await desktop.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await desktop.getByTestId('recognition-result').waitFor();
  await capture(desktop, 'desktop-stormy-sea');
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(previewUrl);
  await mobile
    .getByLabel('Choose an image file')
    .setInputFiles(path.join(root, 'e2e/fixtures/sea-640x480.jpg'));
  await mobile.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await mobile.getByTestId('recognition-result').waitFor();
  await capture(mobile, 'mobile-result');
  await mobile.getByRole('button', { name: 'Analysis details', exact: true }).click();
  await mobile.getByRole('dialog', { name: 'Analysis details' }).waitFor();
  await mobile.screenshot({ path: path.join(destination, 'mobile-details.png'), fullPage: false });
  await mobile.getByRole('region', { name: 'Model reliability' }).scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: path.join(destination, 'mobile-reliability.png'),
    fullPage: false,
  });
  await writeFile(path.join(destination, 'controls.json'), JSON.stringify(mappings, null, 2));
  console.log(`Actual annotated screenshots saved to ${destination}`);
} finally {
  await browser.close();
}
