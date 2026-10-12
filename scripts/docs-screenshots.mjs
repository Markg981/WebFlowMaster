/**
 * The screenshots in the user guides, made from the frames the promo video's capture script takes
 * of the Northwind demo organization, so both stay current with one capture:
 *
 *   NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt node marketing/promo-video/demo/capture.mjs
 *   node scripts/docs-screenshots.mjs
 *
 * Each 3840×2160 PNG becomes a 1600-pixel-wide WebP in docs/public/screenshots/, small enough for
 * the repository and sharp enough to read every label. The capture output itself stays out of git.
 * A frame the capture did not produce is reported and its old screenshot kept.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.SHOTS_DIR ?? path.join(root, 'marketing/promo-video/video/public/shots');
const target = path.join(root, 'docs/public/screenshots');
const WIDTH = 1600;
const QUALITY = 0.82;

/**
 * Docs name: capture frame, or [frame, from] to keep only the part of the frame below `from`
 * (a fraction of its height). Only these are published; the video uses the rest.
 */
export const SCREENSHOTS = {
  dashboard: 'dashboard',
  'test-library': 'library',
  'builder-detected': 'builder-detected',
  'builder-describe': 'builder-describe',
  'builder-sequence': 'builder-sequence',
  'builder-passed': 'builder-passed',
  'api-tester': 'api',
  'test-plans': 'plans',
  'run-in-progress': 'run-2',
  'run-report': 'report',
  // The failed tests and results by module, not the environment table above them: its
  // requested-versus-effective OS rows describe the machine that ran the demo, not the product.
  'run-report-failure': ['report-failure', 0.53],
  reports: 'reports',
  scheduling: 'scheduling',
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(target, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let missing = 0;
  for (const [name, entry] of Object.entries(SCREENSHOTS)) {
    const [frame, from = 0] = Array.isArray(entry) ? entry : [entry];
    const file = path.join(source, `${frame}.png`);
    if (!existsSync(file)) {
      console.log(`  ✗ ${name}: no ${frame}.png in ${source}`);
      missing += 1;
      continue;
    }
    const png = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    const webp = await page.evaluate(
      async ([src, width, quality, top]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const sourceTop = Math.round(image.height * top);
        const sourceHeight = image.height - sourceTop;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.round((sourceHeight * width) / image.width);
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          image,
          0,
          sourceTop,
          image.width,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        return canvas.toDataURL('image/webp', quality);
      },
      [png, WIDTH, QUALITY, from],
    );
    const bytes = Buffer.from(webp.split(',')[1], 'base64');
    writeFileSync(path.join(target, `${name}.webp`), bytes);
    console.log(`  ✓ ${name}.webp (${Math.round(bytes.length / 1024)} KB)`);
  }
  await browser.close();
  if (missing) process.exitCode = 1;
}
