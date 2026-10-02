import path from 'path';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import {
  LIGHTHOUSE_CATEGORIES,
  type LighthouseCategory,
  type LighthouseFinding,
  type PerformanceMetric,
} from '@shared/web-performance';

/**
 * What the browser measured about the page a test is on, and Lighthouse's view of it
 * (shared/web-performance.ts).
 *
 * The page's own numbers come from the Performance APIs, read with `buffered` observers so the
 * entries recorded before the step are included. Chromium reports all of them; Firefox and WebKit
 * have no LCP, layout shifts, long tasks or event timing, and those come back as null rather than
 * as zero, which would read as perfect.
 *
 * Lighthouse is a separate program (`lighthouse` on the PATH, or LIGHTHOUSE_BIN), installed in the
 * worker image rather than as a dependency of the application: it brings a second browser driver
 * and a telemetry SDK that the application has no other use for. It loads the page again, in a
 * Chromium of its own on this runner, with the test's cookies for that address, so a page behind a
 * login is audited logged in. It cannot reach what only a local agent or a remote grid can reach.
 */

export async function measurePagePerformance(page: Page): Promise<{ url: string; metrics: Record<PerformanceMetric, number | null> }> {
  const metrics = await page.evaluate(async () => {
    const observe = (type: string, extra: Record<string, unknown> = {}) =>
      new Promise<PerformanceEntry[] | null>((resolve) => {
        try {
          if (!(PerformanceObserver.supportedEntryTypes ?? []).includes(type)) return resolve(null);
          const seen: PerformanceEntry[] = [];
          const observer = new PerformanceObserver((list) => seen.push(...list.getEntries()));
          observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
          // Buffered entries are delivered in the next task.
          setTimeout(() => {
            seen.push(...observer.takeRecords());
            observer.disconnect();
            resolve(seen);
          }, 100);
        } catch {
          resolve(null);
        }
      });
    const [lcp, shifts, longTasks, events] = await Promise.all([
      observe('largest-contentful-paint'),
      observe('layout-shift'),
      observe('longtask'),
      observe('event', { durationThreshold: 16 }),
    ]);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    // CLS: the largest session window — shifts less than 1 s apart, within 5 s — not counting
    // shifts right after input.
    let cls: number | null = null;
    if (shifts) {
      let best = 0, current = 0, first = 0, last = 0;
      for (const s of shifts as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (s.hadRecentInput) continue;
        if (current && s.startTime - last < 1000 && s.startTime - first < 5000) current += s.value;
        else { current = s.value; first = s.startTime; }
        last = s.startTime;
        best = Math.max(best, current);
      }
      cls = best;
    }
    const fcp = fcpEntry ? fcpEntry.startTime : null;
    const tbt = longTasks
      ? longTasks.filter((t) => fcp === null || t.startTime >= fcp).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)
      : null;
    // INP, approximately: the slowest interaction so far. None yet, nothing to measure.
    const interactions = events ? (events as Array<PerformanceEntry & { interactionId?: number }>).filter((e) => (e.interactionId ?? 0) > 0) : null;
    const inp = interactions && interactions.length ? Math.max(...interactions.map((e) => e.duration)) : null;
    return {
      LCP: lcp && lcp.length ? lcp[lcp.length - 1].startTime : null,
      FCP: fcp,
      CLS: cls,
      INP: inp,
      TBT: tbt,
      TTFB: nav ? nav.responseStart - nav.startTime : null,
      DCL: nav && nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd - nav.startTime : null,
      LOAD: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : null,
      REQUESTS: resources.length + (nav ? 1 : 0),
      // transferSize is 0 for cached and for cross-origin responses without Timing-Allow-Origin.
      WEIGHT: resources.reduce((sum, r) => sum + (r.transferSize || 0), nav?.transferSize || 0),
    };
  });
  return { url: page.url(), metrics };
}

export const LIGHTHOUSE_TIMEOUT_MS = Number(process.env.LIGHTHOUSE_TIMEOUT_MS) || 120_000;

export class LighthouseUnavailableError extends Error {}

function lighthouseBin(): string {
  return process.env.LIGHTHOUSE_BIN || 'lighthouse';
}

/**
 * Runs Lighthouse against `url` and keeps its HTML report in `outputDir` when there is one.
 * Throws LighthouseUnavailableError when the program is not installed on this runner.
 */
export async function runLighthouse(input: {
  url: string;
  cookieHeader?: string;
  formFactor: 'mobile' | 'desktop';
  outputDir?: string;
}): Promise<Omit<LighthouseFinding, 'checks'>> {
  const dir = input.outputDir ?? (await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'wfm-lighthouse-')));
  await fs.ensureDir(dir);
  const base = path.join(dir, `lighthouse_${Date.now()}`);
  const args = [
    input.url,
    '--output=json',
    '--output=html',
    `--output-path=${base}`,
    `--only-categories=${LIGHTHOUSE_CATEGORIES.join(',')}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
    '--quiet',
    ...(input.formFactor === 'desktop' ? ['--preset=desktop'] : []),
    ...(input.cookieHeader ? [`--extra-headers=${JSON.stringify({ Cookie: input.cookieHeader })}`] : []),
  ];
  await new Promise<void>((resolve, reject) => {
    execFile(lighthouseBin(), args, {
      timeout: LIGHTHOUSE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      // Lighthouse finds its browser through CHROME_PATH: Playwright's Chromium unless one is set.
      env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() },
    }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new LighthouseUnavailableError(
          'Lighthouse is not installed on this runner. The worker image includes it; elsewhere install it with npm install -g lighthouse, or set LIGHTHOUSE_BIN.',
        ));
      }
      if (error.killed) return reject(new Error(`Lighthouse did not finish within ${Math.round(LIGHTHOUSE_TIMEOUT_MS / 1000)} s.`));
      const last = String(stderr).trim().split('\n').filter(Boolean).slice(-2).join(' ');
      reject(new Error(`Lighthouse could not audit the page: ${last || error.message}`));
    });
  });
  const report = await fs.readJson(`${base}.report.json`);
  if (report.runtimeError?.message) throw new Error(`Lighthouse could not audit the page: ${report.runtimeError.message}`);
  const scores: Partial<Record<LighthouseCategory, number>> = {};
  for (const category of LIGHTHOUSE_CATEGORIES) {
    const score = report.categories?.[category]?.score;
    if (typeof score === 'number') scores[category] = Math.round(score * 100);
  }
  const audit = (id: string) => {
    const value = report.audits?.[id]?.numericValue;
    return typeof value === 'number' ? value : undefined;
  };
  const metrics = Object.fromEntries(
    Object.entries({
      LCP: audit('largest-contentful-paint'),
      FCP: audit('first-contentful-paint'),
      CLS: audit('cumulative-layout-shift'),
      TBT: audit('total-blocking-time'),
      SI: audit('speed-index'),
      TTI: audit('interactive'),
    }).filter(([, v]) => v !== undefined),
  ) as LighthouseFinding['metrics'];
  const html = `${base}.report.html`;
  await fs.remove(`${base}.report.json`);
  const kept = !!input.outputDir && (await fs.pathExists(html));
  if (!input.outputDir) await fs.remove(dir);
  return {
    url: input.url,
    formFactor: input.formFactor,
    scores,
    metrics,
    // A file path, like a step's screenshot: the report routes turn it into a link (artifacts.routes.ts).
    ...(kept ? { reportUrl: html } : {}),
  };
}
