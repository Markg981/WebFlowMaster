import type { Response } from 'express';
import { loadReportModel, readScreenshot, type ReportModel } from './report-model';
import { renderReportHtml } from './report-html';
import { buildAllureResults } from './allure-export';
import { createZip } from './zip';
import { reportUrlFor } from './report-links';

/**
 * A run as a file to hand on: HTML to read anywhere, PDF to attach or file, Allure results to load
 * where a team already keeps its history. See server/report-model.ts for why they share one model.
 */

export const REPORT_EXPORT_FORMATS = ['html', 'pdf', 'allure'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export function isReportExportFormat(value: unknown): value is ReportExportFormat {
  return typeof value === 'string' && (REPORT_EXPORT_FORMATS as readonly string[]).includes(value);
}

export interface ExportedReport {
  body: Buffer;
  contentType: string;
  filename: string;
}

/** Screenshots are embedded for the results that did not pass, and for at most this many. */
export const MAX_EMBEDDED_SCREENSHOTS = 25;

export class ReportExportError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'ReportExportError';
  }
}

/** Renders HTML to a PDF. Replaceable, so the routes can be tested without a browser. */
export type PdfRenderer = (html: string) => Promise<Buffer>;

export const chromiumPdf: PdfRenderer = async (html) => {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new ReportExportError(
      'pdf_unavailable',
      `PDF export needs a Chromium on the server, and none could be started: ${(error as Error).message}. The HTML export has the same content.`,
      503,
    );
  }
  try {
    const page = await browser.newPage();
    // Everything is inline, so nothing is waited for but the document itself.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close().catch(() => {});
  }
};

async function screenshotsOf(model: ReportModel) {
  const failing = model.results.filter((r) => r.status !== 'Passed' && r.screenshotPath).slice(0, MAX_EMBEDDED_SCREENSHOTS);
  const images = new Map<string, { bytes: Buffer; contentType: string }>();
  for (const result of failing) {
    const image = await readScreenshot(model, result.screenshotPath);
    // Only images, whatever the stored path claims to be: the HTML embeds these as data URIs.
    if (image && /^image\/(png|jpeg)$/.test(image.contentType)) images.set(result.id, image);
  }
  return images;
}

function fileStem(model: ReportModel): string {
  const plan = model.planName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'run';
  return `${plan}-${model.executionId.slice(0, 8)}`;
}

/**
 * Sent as a download. These are files to keep; and an HTML report opened in place would be a
 * page of ours rendering whatever a test's name or failure message said.
 */
export function sendExport(res: Response, exported: ExportedReport) {
  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(exported.body);
}

/** The run in the asked format, or null when there is no such run in the caller's organization. */
export async function exportRun(
  executionId: string,
  format: ReportExportFormat,
  renderPdf: PdfRenderer = chromiumPdf,
): Promise<ExportedReport | null> {
  const model = await loadReportModel(executionId);
  if (!model) return null;
  const images = await screenshotsOf(model);
  const reportUrl = reportUrlFor(model.planId, model.executionId) ?? null;
  const stem = fileStem(model);

  if (format === 'allure') {
    return {
      body: createZip(buildAllureResults(model, { images, reportUrl })),
      contentType: 'application/zip',
      filename: `${stem}-allure-results.zip`,
    };
  }

  const html = renderReportHtml(model, {
    images: new Map(Array.from(images, ([id, image]) => [id, `data:${image.contentType};base64,${image.bytes.toString('base64')}`])),
    reportUrl,
  });
  if (format === 'html') {
    return { body: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8', filename: `${stem}.html` };
  }
  return { body: await renderPdf(html), contentType: 'application/pdf', filename: `${stem}.pdf` };
}
