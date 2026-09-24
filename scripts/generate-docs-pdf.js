/**
 * The documentation as PDF files, one per section of the sidebar and per language, for an audit
 * file or a reader offline: `npm run docs:pdf` builds the site and writes docs/pdf/{en,it}/*.pdf.
 *
 * It prints the site VitePress built rather than rendering the Markdown again: the pages then look
 * as they do online, containers and tables included, and the diagrams (drawn in the browser by
 * Mermaid) are there too. The sections come from the site's own sidebar, so a page added to the
 * site is in the PDF without touching this file.
 *
 * Playwright, which the product already ships with its browsers, does the printing. Nothing is
 * fetched from the internet.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'docs/.vitepress/dist');
const outputDir = path.join(root, 'docs/pdf');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** The built site, as VitePress serves it with clean URLs. */
function serveSite() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const candidates = url.endsWith('/') ? [`${url}index.html`] : [url, `${url}.html`, `${url}/index.html`];
    for (const candidate of candidates) {
      const file = path.join(siteDir, candidate);
      if (file.startsWith(siteDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A section's file name: its first page's folder, or "integrations" for the pages at the top. */
function sectionName(firstLink) {
  const segment = firstLink.split('/').filter(Boolean)[1] ?? 'index';
  return /^[A-Z_]+$/.test(segment) ? 'integrations' : segment;
}

const PRINT_CSS = `
  .VPNav, .VPLocalNav, .VPSidebar, .aside, .VPDocFooter, .VPFooter, .header-anchor, .edit-link { display: none !important; }
  .VPContent, .VPDoc, .VPDoc .container, .VPDoc .content, .VPDoc .content-container { padding: 0 !important; margin: 0 !important; max-width: none !important; }
  .wfm-page { break-before: page; }
  .wfm-cover { height: 90vh; display: flex; flex-direction: column; justify-content: center; }
  .wfm-cover h1 { font-size: 40px; border: none; }
  .wfm-cover p { color: #555; margin: 4px 0; }
  pre, table, .custom-block, svg { break-inside: avoid; }
`;

async function main() {
  if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
    throw new Error('The site is not built: run `npm run docs:build` first (npm run docs:pdf does).');
  }
  const { default: config } = await import(pathToFileURL(path.join(root, 'docs/.vitepress/config.mts')).href);
  const server = await serveSite();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });

  try {
    for (const [lang, locale] of Object.entries(config.locales).filter(([lang]) => lang !== 'root')) {
      const sidebar = locale.themeConfig.sidebar[`/${lang}/`];
      fs.mkdirSync(path.join(outputDir, lang), { recursive: true });

      for (const group of sidebar) {
        const pages = [];
        for (const item of group.items) {
          await page.goto(base + item.link, { waitUntil: 'networkidle' });
          // Diagrams are drawn after the page loads.
          if (await page.locator('.mermaid').count()) {
            await page.waitForFunction(() => [...document.querySelectorAll('.mermaid')].every((d) => d.querySelector('svg')), null, { timeout: 15000 }).catch(() => {});
          }
          pages.push(await page.locator('.vp-doc').first().innerHTML());
        }

        const cover = `
          <div class="wfm-cover">
            <h1>${group.text}</h1>
            <p>WebFlowMaster ${version}</p>
            <p>${new Date().toISOString().slice(0, 10)}</p>
          </div>`;
        await page.goto(base + group.items[0].link, { waitUntil: 'networkidle' });
        await page.evaluate(({ css, html }) => {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.append(style);
          document.querySelector('.vp-doc').innerHTML = html;
        }, { css: PRINT_CSS, html: cover + pages.map((body) => `<div class="wfm-page">${body}</div>`).join('') });

        const file = path.join(outputDir, lang, `${sectionName(group.items[0].link)}.pdf`);
        await page.pdf({
          path: file,
          format: 'A4',
          printBackground: true,
          margin: { top: '1.5cm', right: '1.5cm', bottom: '1.8cm', left: '1.5cm' },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888">WebFlowMaster · ${group.text} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
        });
        console.log(`${path.relative(root, file)} (${pages.length} pages)`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
