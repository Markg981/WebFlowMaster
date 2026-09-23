import { createRequire } from 'module';
import type { Page } from 'playwright';
import { summariseAxe, type AccessibilityFinding, type AccessibilityImpact, type AxeRunResult } from '@shared/accessibility';

/**
 * Runs axe-core in a page. See shared/accessibility.ts for what is kept and why.
 *
 * The engine is injected through `page.evaluate` rather than a script tag, because evaluate goes
 * through the browser's debugging protocol and is not subject to the page's Content Security
 * Policy. A strict CSP is common on exactly the applications that care about compliance, and a
 * check that silently could not load there would report a clean page.
 */

const require = createRequire(import.meta.url);
let axeSource: string | null = null;

function source(): string {
  // axe-core ships its browser build as a string on the module: the file is ~500 KB, read once.
  if (axeSource === null) axeSource = (require('axe-core') as { source: string }).source;
  return axeSource;
}

export async function scanAccessibility(page: Page, threshold: AccessibilityImpact): Promise<AccessibilityFinding> {
  const loaded = await page.evaluate(() => typeof (window as any).axe?.run === 'function');
  if (!loaded) await page.evaluate(source());
  const result = (await page.evaluate(async () => {
    const run = await (window as any).axe.run(document, {
      // Only what fails: the passes are counted, not listed, and the list is large.
      resultTypes: ['violations'],
    });
    return {
      url: location.href,
      violations: run.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.map((n: any) => ({ target: n.target })),
      })),
      passes: run.passes.map(() => 0),
      incomplete: run.incomplete.map(() => 0),
    };
  })) as AxeRunResult;
  return summariseAxe(result, threshold);
}
