import type { ComparisonDifference, ComparisonResultVerdict } from '@shared/comparison';
import { COMPARISON_RESULT_VERDICTS } from '@shared/comparison';
import { escapeHtml } from '../report-html';
import type { ComparisonReportModel, ComparisonReportResult } from './comparison-report-model';

/**
 * The parity report as one HTML file: no scripts, no requests, styles inline. Like the run export
 * (server/reporting/report-html.ts) it opens anywhere and is the source of the PDF.
 */

export const OVERALL_VERDICT_LABEL: Record<string, string> = {
  regressions: 'Regressions found',
  inconclusive: 'Inconclusive',
  parity_with_accepted: 'Parity with accepted differences',
  parity: 'Parity',
};

export const RESULT_VERDICT_LABEL: Record<ComparisonResultVerdict, string> = {
  identical: 'Identical',
  equivalent: 'Equivalent',
  different: 'Different',
  outcome_mismatch: 'Outcome mismatch',
  both_failed: 'Both failed',
  not_comparable: 'Not comparable',
};

const REVIEW_LABEL: Record<string, string> = {
  open: 'Not reviewed',
  accepted: 'Accepted',
  defect: 'Defect',
};

const VERDICT_CLASS: Record<string, string> = {
  identical: 'pass',
  equivalent: 'pass',
  different: 'fail',
  outcome_mismatch: 'fail',
  both_failed: 'error',
  not_comparable: 'skip',
};

const OVERALL_CLASS: Record<string, string> = {
  regressions: 'v-fail',
  inconclusive: 'v-error',
  parity_with_accepted: 'v-pass',
  parity: 'v-pass',
};

const CSS = `
  :root { --pass:#15803d; --fail:#b91c1c; --error:#c2410c; --skip:#6b7280; --line:#e5e7eb; --muted:#6b7280; }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#111827; margin:0; padding:32px; max-width:1100px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:28px 0 10px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  h3 { font-size:15px; margin:0; }
  .muted { color:var(--muted); } .mono { font-family: ui-monospace, Consolas, monospace; font-size:12px; overflow-wrap:anywhere; }
  .verdict { display:inline-block; padding:2px 10px; border-radius:999px; color:#fff; font-weight:600; font-size:13px; }
  .v-pass { background:var(--pass); } .v-fail { background:var(--fail); } .v-error { background:var(--error); } .v-other { background:var(--skip); }
  dl.meta { display:grid; grid-template-columns: max-content 1fr; gap:4px 16px; margin:16px 0; }
  dl.meta dt { color:var(--muted); } dl.meta dd { margin:0; }
  .tiles { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:8px 14px; min-width:100px; }
  .tile b { display:block; font-size:22px; } .tile span { color:var(--muted); font-size:12px; }
  table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--muted); font-weight:600; }
  .st { font-weight:600; } .pass { color:var(--pass); } .fail { color:var(--fail); } .error { color:var(--error); } .skip { color:var(--skip); }
  .tag { display:inline-block; border:1px solid var(--line); border-radius:4px; padding:0 5px; font-size:11px; margin-left:4px; color:var(--muted); }
  .case { border:1px solid var(--line); border-left:4px solid var(--fail); border-radius:6px; padding:12px 14px; margin:12px 0; page-break-inside:avoid; }
  .case.accepted { border-left-color:var(--pass); } .case.hidden { border-left-color:var(--skip); }
  .note { white-space:pre-wrap; background:#f9fafb; border-radius:4px; padding:8px; margin:8px 0; }
  .footer { margin-top:32px; font-size:12px; color:var(--muted); }
  @media print { body { padding:0; } h2 { page-break-after:avoid; } }
`;

function when(date: Date | null | undefined): string {
  return date ? new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
}

function duration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A value of a difference, short enough for a table cell. */
function shown(value: unknown): string {
  if (value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function differenceRow(d: ComparisonDifference): string {
  const where = [d.checkpoint, d.stepId].filter(Boolean).join(' · ') || 'whole test';
  return `<tr><td>${escapeHtml(d.kind)}</td><td>${escapeHtml(where)}</td><td class="mono">${escapeHtml(d.path)}</td><td class="mono">${escapeHtml(shown(d.baseline))}</td><td class="mono">${escapeHtml(shown(d.candidate))}</td><td>${escapeHtml(d.severity)}${d.knownDifferenceId ? '<span class="tag">known</span>' : ''}</td></tr>`;
}

function caseSection(result: ComparisonReportResult): string {
  const kind = result.hidden ? ' hidden' : result.reviewStatus === 'accepted' ? ' accepted' : '';
  const more = result.differenceCount - result.differences.length;
  const review =
    result.reviewStatus === 'open'
      ? '<div><b>Review:</b> not reviewed</div>'
      : `<div><b>Review:</b> ${escapeHtml(REVIEW_LABEL[result.reviewStatus] ?? result.reviewStatus)}${result.reviewedBy ? ` by ${escapeHtml(result.reviewedBy)}` : ''}${result.reviewedAt ? `, ${when(result.reviewedAt)}` : ''}</div>`;
  return `
  <div class="case${kind}">
    <h3>${escapeHtml(result.testName)} <span class="st ${VERDICT_CLASS[result.verdict] ?? 'skip'}">${escapeHtml(RESULT_VERDICT_LABEL[result.verdict] ?? result.verdict)}</span>${result.browser ? `<span class="tag">${escapeHtml(result.browser)}</span>` : ''}</h3>
    <div class="muted">${escapeHtml([result.module, result.component].filter(Boolean).join(' / ') || 'No module')} · ${duration(result.baselineDurationMs)} → ${duration(result.candidateDurationMs)}</div>
    ${review}
    ${result.reviewNote ? `<div class="note">${escapeHtml(result.reviewNote)}</div>` : ''}
    ${
      result.hidden
        ? '<p class="muted">This test belongs to a project the exporter is not on: its differences are not included.</p>'
        : result.differences.length
          ? `<table><thead><tr><th>Kind</th><th>Where</th><th>Path</th><th>Baseline</th><th>Candidate</th><th>Severity</th></tr></thead><tbody>${result.differences.map(differenceRow).join('')}</tbody></table>${more > 0 ? `<p class="muted">And ${more} more difference${more === 1 ? '' : 's'}, in the live report.</p>` : ''}`
          : ''
    }
  </div>`;
}

function policySection(model: ComparisonReportModel): string {
  const p = model.policy;
  const rows: Array<[string, string]> = [
    [
      'Text',
      `collapse whitespace ${p.text.collapseWhitespace ? 'on' : 'off'}, ignore case ${p.text.ignoreCase ? 'on' : 'off'}${p.text.replace.length ? `, ${p.text.replace.length} replace rule${p.text.replace.length === 1 ? '' : 's'}: ${p.text.replace.map((r) => `${r.pattern} → ${r.with || '(empty)'}`).join('; ')}` : ''}`,
    ],
    [
      'Numbers',
      `absolute tolerance ${p.numeric.absTolerance}, relative tolerance ${p.numeric.relTolerance * 100}%`,
    ],
    [
      'Network',
      `include ${p.network.include.join(', ') || '(nothing)'}${p.network.ignoreQueryParams.length ? `; ignored query parameters ${p.network.ignoreQueryParams.join(', ')}` : ''}; response hash ${p.network.compareResponseHash ? 'compared' : 'not compared'}`,
    ],
    ['Visual', `${p.visual.mode}, threshold ${p.visual.threshold * 100}%`],
    ['Performance', `${p.performance.mode}, slowdown above ${p.performance.maxSlowdownPct}%`],
  ];
  return `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>`;
}

export function renderComparisonReportHtml(
  model: ComparisonReportModel,
  options: { generatedAt?: Date } = {},
): string {
  const title = model.name || model.planName || 'Comparison';
  const overall = model.verdict
    ? `<span class="verdict ${OVERALL_CLASS[model.verdict] ?? 'v-other'}">${escapeHtml(OVERALL_VERDICT_LABEL[model.verdict] ?? model.verdict)}</span>`
    : `<span class="verdict v-other">${escapeHtml(model.status)}</span>`;
  const summary = model.summary;
  const attention = model.results.filter(
    (r) => r.verdict !== 'identical' && r.verdict !== 'equivalent',
  );
  const sideRow = (label: string, side: ComparisonReportModel['baseline']) =>
    `<dt>${label}</dt><dd>${escapeHtml(side.environmentName)} · <span class="mono">${escapeHtml(side.executionId ?? 'not started')}</span>${side.status ? ` · ${escapeHtml(side.status)}` : ''}${side.startedAt ? ` · ${when(side.startedAt)} → ${when(side.completedAt)}` : ''}</dd>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Parity report — ${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
  <h1>Parity report: ${escapeHtml(title)}</h1>
  <div>${overall}</div>
  ${model.failureMessage && model.status !== 'completed' ? `<p>${escapeHtml(model.failureMessage)}</p>` : ''}
  <dl class="meta">
    <dt>Plan</dt><dd>${escapeHtml(model.planName ?? model.planId)}</dd>
    <dt>Comparison</dt><dd class="mono">${escapeHtml(model.comparisonId)}</dd>
    ${sideRow('Baseline', model.baseline)}
    ${sideRow('Candidate', model.candidate)}
    <dt>Mode</dt><dd>${escapeHtml(model.mode)}</dd>
    <dt>Status</dt><dd>${escapeHtml(model.status)}</dd>
    <dt>Requested by</dt><dd>${escapeHtml(model.requestedBy ?? '—')}</dd>
    <dt>Started</dt><dd>${when(model.createdAt)}</dd>
    <dt>Completed</dt><dd>${when(model.completedAt)}</dd>
  </dl>
  ${
    summary
      ? `<div class="tiles"><div class="tile"><b>${summary.total}</b><span>tests</span></div>${COMPARISON_RESULT_VERDICTS.filter(
          (v) => summary.byVerdict[v],
        )
          .map(
            (v) =>
              `<div class="tile"><b class="${VERDICT_CLASS[v]}">${summary.byVerdict[v]}</b><span>${escapeHtml(RESULT_VERDICT_LABEL[v].toLowerCase())}</span></div>`,
          )
          .join(
            '',
          )}</div>${summary.droppedDifferences ? `<p class="muted">${summary.droppedDifferences} differences were found beyond the limit per test and not stored.</p>` : ''}`
      : '<p class="muted">The comparison has not been computed yet.</p>'
  }

  ${
    summary?.byModule.length
      ? `<h2>Parity by module</h2><table><thead><tr><th>Module</th><th>Tests</th>${COMPARISON_RESULT_VERDICTS.map((v) => `<th>${escapeHtml(RESULT_VERDICT_LABEL[v])}</th>`).join('')}</tr></thead><tbody>${summary.byModule
          .map(
            (m) =>
              `<tr><td>${escapeHtml(m.module || 'No module')}</td><td>${m.total}</td>${COMPARISON_RESULT_VERDICTS.map((v) => `<td>${m.byVerdict[v] || ''}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table>`
      : ''
  }

  <h2>Tolerances applied</h2>
  ${policySection(model)}

  <h2>Differences and reviews (${attention.length})</h2>
  ${attention.length ? attention.map(caseSection).join('') : '<p>Every test behaved the same on both environments.</p>'}

  <h2>Every test</h2>
  <table>
    <thead><tr><th>Test</th><th>Browser</th><th>Module</th><th>Verdict</th><th>Review</th><th>Duration</th></tr></thead>
    <tbody>
      ${model.results
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.testName)}</td><td>${escapeHtml(r.browser ?? '—')}</td><td>${escapeHtml([r.module, r.component].filter(Boolean).join(' / ') || '—')}</td><td class="st ${VERDICT_CLASS[r.verdict] ?? 'skip'}">${escapeHtml(RESULT_VERDICT_LABEL[r.verdict] ?? r.verdict)}</td><td>${escapeHtml(REVIEW_LABEL[r.reviewStatus] ?? r.reviewStatus)}</td><td>${duration(r.baselineDurationMs)} → ${duration(r.candidateDurationMs)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  ${model.omittedResults ? `<p class="muted">${model.omittedResults} more tests are in the live report and not listed here.</p>` : ''}
  <p class="muted">The comparison reproduces inputs, not external state: both environments were expected to hold equivalent data. Screenshots are not included in this file.</p>
  <div class="footer">Exported ${when(options.generatedAt ?? new Date())} by WebFlowMaster.</div>
</body>
</html>
`;
}
