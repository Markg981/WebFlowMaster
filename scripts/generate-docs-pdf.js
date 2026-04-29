import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_BASE_DIR = path.join(__dirname, '../docs');
const OUTPUT_BASE_DIR = path.join(__dirname, '../docs/pdf');

async function generatePDF(lang, fileName, title) {
  const mdPath = path.join(DOCS_BASE_DIR, lang, fileName);
  const outputDir = path.join(OUTPUT_BASE_DIR, lang);
  const pdfPath = path.join(outputDir, fileName.replace('.md', '.pdf'));

  if (!await fs.pathExists(mdPath)) {
    console.warn(`File non trovato per lingua ${lang}: ${mdPath}`);
    return;
  }

  const markdown = await fs.readFile(mdPath, 'utf-8');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown.min.css">
    <style>
        body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 45px; }
        .markdown-body { font-family: "Inter", -apple-system, sans-serif; line-height: 1.6; }
        
        /* Cover Page */
        .cover {
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            border-bottom: 2px solid #0052cc;
            margin-bottom: 50px;
        }
        .cover h1 { font-size: 48px; color: #0052cc; margin-bottom: 10px; border: none; }
        .cover p { font-size: 18px; color: #555; }
        
        /* Fix empty page and H1 breaks */
        h1:not(.cover-title) { break-before: page; margin-top: 50px; }
        h1.cover-title { break-before: avoid; }
        
        @media print {
            body { padding: 0; }
            .markdown-body { font-size: 14px; }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body class="markdown-body">
    <div class="cover">
        <h1 class="cover-title">${title}</h1>
        <p>WebFlowMaster Enterprise Documentation</p>
        <p>Language: ${lang.toUpperCase()} | Version 1.0.0</p>
        <p>Generated on: ${new Date().toLocaleDateString()}</p>
    </div>
    <div id="content"></div>
    <script>
        document.getElementById('content').innerHTML = marked.parse(\`${markdown.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`);
    </script>
</body>
</html>
  `;

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  await fs.ensureDir(outputDir);

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '1cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size: 10px; width: 100%; text-align: center; border-top: 1px solid #eee; padding-top: 5px;">WebFlowMaster | <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  });

  await browser.close();
  console.log(`✅ PDF [${lang.toUpperCase()}] generato: ${pdfPath}`);
}

async function main() {
  const languages = ['it', 'en'];
  const docs = [
    { file: 'USER_GUIDE.md', title: 'User Guide' },
    { file: 'ADMIN_GUIDE.md', title: 'Administrator Guide' }
  ];

  for (const lang of languages) {
    for (const doc of docs) {
      await generatePDF(lang, doc.file, doc.title);
    }
  }
}

main();
