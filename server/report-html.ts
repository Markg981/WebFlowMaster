import type { ReportModel, ReportResultModel } from './report-model';

/**
 * A run as one HTML file that opens anywhere: no scripts, no requests, styles inline, images
 * embedded. Sent as an attachment, opened on a laptop on a train, printed for an audit, it looks
 * the same. It is also the source of the PDF, so its print styles are the PDF's layout.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function duration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

const when = (date: Date | null | undefined) => (date ? new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—');

const STATUS_CLASS: Record<string, string> = { Passed: 'pass', Failed: 'fail', Error: 'error', Skipped: 'skip', Pending: 'skip' };

const RUN_VERDICT: Record<string, string> = {
  completed: 'Passed',
  failed: 'Failed',
  error: 'Did not finish',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
};

const CSS = `
  :root { --pass:#15803d; --fail:#b91c1c; --error:#c2410c; --skip:#6b7280; --line:#e5e7eb; --muted:#6b7280; }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#111827; margin:0; padding:32px; max-width:1100px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:28px 0 10px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  h3 { font-size:15px; margin:0; }
  .muted { color:var(--muted); } .mono { font-family: ui-monospace, Consolas, monospace; font-size:12px; }
  .verdict { display:inline-block; padding:2px 10px; border-radius:999px; color:#fff; font-weight:600; font-size:13px; }
  .v-completed { background:var(--pass); } .v-failed, .v-timed_out { background:var(--fail); } .v-error { background:var(--error); } .v-other { background:var(--skip); }
  dl.meta { display:grid; grid-template-columns: max-content 1fr; gap:4px 16px; margin:16px 0; }
  dl.meta dt { color:var(--muted); } dl.meta dd { margin:0; }
  .tiles { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:8px 14px; min-width:100px; }
  .tile b { display:block; font-size:22px; } .tile span { color:var(--muted); font-size:12px; }
  table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--muted); font-weight:600; }
  .st { font-weight:600; } .pass { color:var(--pass); } .fail { color:var(--fail); } .error { color:var(--error); } .skip { color:var(--skip); }
  .tag { display:inline-block; border:1px solid var(--line); border-radius:4px; padding:0 5px; font-size:11px; margin-left:4px; color:var(--muted); }
  .failure { border:1px solid var(--line); border-left:4px solid var(--fail); border-radius:6px; padding:12px 14px; margin:12px 0; page-break-inside:avoid; }
  .failure.quarantined { border-left-color:var(--skip); }
  .reason { white-space:pre-wrap; background:#f9fafb; border-radius:4px; padding:8px; margin:8px 0; }
  ol.steps { margin:6px 0 0 18px; padding:0; } ol.steps li { margin:2px 0; }
  img.shot { max-width:100%; border:1px solid var(--line); border-radius:4px; margin-top:8px; }
  .footer { margin-top:32px; font-size:12px; color:var(--muted); }
  @media print { body { padding:0; } h2 { page-break-after:avoid; } }
`;

export interface HtmlRenderOptions {
  /** Screenshots to embed, by result id, as data URIs. */
  images?: Map<string, string>;
  /** Where the live report is, when this installation knows its own address. */
  reportUrl?: string | null;
  generatedAt?: Date;
}

function resultTags(result: ReportResultModel): string {
  const tags: string[] = [];
  if (result.quarantined) tags.push('quarantined');
  if (result.attempts > 1) tags.push(`${result.attempts} attempts`);
  if (result.testVersion !== null) tags.push(`v${result.testVersion}`);
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

function failureSection(result: ReportResultModel, image: string | undefined): string {
  const failedStep = result.steps.find((step) => step.status === 'failed');
  const network = result.network?.failures.filter((r) => r.status >= 500 || r.status === 0).slice(0, 5) ?? [];
  const a11y = result.steps.flatMap((step) => step.accessibility?.violations.filter((v) => v.blocking) ?? []);
  return `
  <div class="failure${result.quarantined ? ' quarantined' : ''}">
    <h3>${escapeHtml(result.testName)} <span class="st ${STATUS_CLASS[result.status] ?? 'skip'}">${escapeHtml(result.status)}</span>${resultTags(result)}</h3>
    <div class="muted">${escapeHtml(result.browser ?? 'default browser')} · ${duration(result.durationMs)}${result.quarantined ? ' · in quarantine: did not fail the run' : ''}</div>
    ${result.reason ? `<div class="reason">${escapeHtml(result.reason)}</div>` : ''}
    ${failedStep ? `<div><b>Failed at:</b> ${escapeHtml(failedStep.name)} <span class="muted">(${escapeHtml(failedStep.type)})</span></div>` : ''}
    ${network.length ? `<div><b>Requests that failed:</b><ul>${network.map((r) => `<li class="mono">${escapeHtml(r.method)} ${escapeHtml(r.url)} → ${r.status === 0 ? escapeHtml(r.statusText || 'no response') : r.status}</li>`).join('')}</ul></div>` : ''}
    ${a11y.length ? `<div><b>Accessibility violations:</b><ul>${a11y.map((v) => `<li>${escapeHtml(v.id)} (${escapeHtml(v.impact)}, ${v.count} element${v.count === 1 ? '' : 's'}): ${escapeHtml(v.help)}</li>`).join('')}</ul></div>` : ''}
    ${result.steps.length ? `<details open><summary class="muted">Steps</summary><ol class="steps">${result.steps.map((step) => `<li><span class="${step.status === 'failed' ? 'fail' : 'pass'}">${step.status === 'failed' ? '✗' : '✓'}</span> ${escapeHtml(step.name)}${step.status === 'failed' && step.message ? ` <span class="muted">— ${escapeHtml(step.message)}</span>` : ''}</li>`).join('')}</ol></details>` : ''}
    ${image ? `<img class="shot" alt="Screenshot of ${escapeHtml(result.testName)}" src="${image}">` : ''}
  </div>`;
}

export function renderReportHtml(model: ReportModel, options: HtmlRenderOptions = {}): string {
  const images = options.images ?? new Map<string, string>();
  const failures = model.results.filter((r) => r.status === 'Failed' || r.status === 'Error');
  const verdictClass = ['completed', 'failed', 'timed_out', 'error'].includes(model.status) ? `v-${model.status}` : 'v-other';
  const c = model.counts;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(model.planName)} — run ${escapeHtml(model.executionId)}</title>
<style>${CSS}</style>
</head>
<body>
  <h1>${escapeHtml(model.planName)}</h1>
  <div><span class="verdict ${verdictClass}">${escapeHtml(RUN_VERDICT[model.status] ?? model.status)}</span></div>
  ${model.failureMessage && model.status !== 'completed' && model.status !== 'failed' ? `<p>${escapeHtml(model.failureMessage)}</p>` : ''}
  <dl class="meta">
    <dt>Run</dt><dd class="mono">${escapeHtml(model.executionId)}</dd>
    <dt>Started</dt><dd>${when(model.startedAt)}</dd>
    <dt>Finished</dt><dd>${when(model.completedAt)}</dd>
    <dt>Duration</dt><dd>${duration(model.durationMs)}</dd>
    <dt>Triggered by</dt><dd>${escapeHtml(model.trigger)}${model.maxAttempts > 1 ? ` · attempt ${model.attempt} of ${model.maxAttempts}` : ''}</dd>
    ${model.environment ? `<dt>Environment</dt><dd>${escapeHtml(model.environment)}</dd>` : ''}
    ${model.runner ? `<dt>Runner</dt><dd class="mono">${escapeHtml(model.runner)}</dd>` : ''}
    ${options.reportUrl ? `<dt>Live report</dt><dd class="mono">${escapeHtml(options.reportUrl)}</dd>` : ''}
  </dl>
  <div class="tiles">
    <div class="tile"><b>${c.total}</b><span>tests</span></div>
    <div class="tile"><b class="pass">${c.passed}</b><span>passed</span></div>
    <div class="tile"><b class="fail">${c.failed}</b><span>failed</span></div>
    ${c.errors ? `<div class="tile"><b class="error">${c.errors}</b><span>did not run</span></div>` : ''}
    ${c.skipped ? `<div class="tile"><b class="skip">${c.skipped}</b><span>skipped</span></div>` : ''}
    ${c.quarantinedFailures ? `<div class="tile"><b class="skip">${c.quarantinedFailures}</b><span>failures in quarantine</span></div>` : ''}
    ${c.flaky ? `<div class="tile"><b>${c.flaky}</b><span>passed on a retry</span></div>` : ''}
  </div>
  ${model.evidencePurged ? '<p class="muted">Screenshots, videos and traces of this run were removed by the retention policy; its results are kept.</p>' : ''}

  ${failures.length ? `<h2>What failed (${failures.length})</h2>${failures.map((r) => failureSection(r, images.get(r.id))).join('')}` : ''}

  <h2>Every result</h2>
  <table>
    <thead><tr><th>Test</th><th>Browser</th><th>Status</th><th>Duration</th><th>Module</th></tr></thead>
    <tbody>
      ${model.results
        .map(
          (r) => `<tr><td>${escapeHtml(r.testName)}${resultTags(r)}</td><td>${escapeHtml(r.browser ?? '—')}</td><td class="st ${STATUS_CLASS[r.status] ?? 'skip'}">${escapeHtml(r.status)}</td><td>${duration(r.durationMs)}</td><td>${escapeHtml([r.module, r.component].filter(Boolean).join(' / ') || '—')}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <div class="footer">Exported ${when(options.generatedAt ?? new Date())} by WebFlowMaster.</div>
</body>
</html>
`;
}
