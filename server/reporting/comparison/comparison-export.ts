import type { EvidencePrincipal } from '../../tenancy/artifact-access';
import { chromiumPdf, type ExportedReport, type PdfRenderer } from '../report-export';
import { renderComparisonReportHtml } from './comparison-report-html';
import {
  loadComparisonReportModel,
  type ComparisonExportFormat,
  type ComparisonReportModel,
} from './comparison-report-model';

function fileStem(model: ComparisonReportModel): string {
  const base =
    (model.name || model.planName || 'comparison')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'comparison';
  return `parity-${base}-${model.comparisonId.slice(0, 8)}`;
}

/** The comparison's parity report in the asked format, or null when there is no such comparison. */
export async function exportComparison(
  comparisonId: string,
  format: ComparisonExportFormat,
  principal: EvidencePrincipal | null,
  renderPdf: PdfRenderer = chromiumPdf,
): Promise<ExportedReport | null> {
  const model = await loadComparisonReportModel(comparisonId, principal);
  if (!model) return null;
  const html = renderComparisonReportHtml(model);
  const stem = fileStem(model);
  if (format === 'html')
    return {
      body: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8',
      filename: `${stem}.html`,
    };
  return { body: await renderPdf(html), contentType: 'application/pdf', filename: `${stem}.pdf` };
}
