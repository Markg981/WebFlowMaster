/**
 * How a run's tests are laid out: one lane per browser and language, each the whole plan in
 * order. Pure — it decides the layout from the frozen tests and does not run anything.
 */
import type { ApiTest } from '@shared/schema';
import { LOCALE_VARIABLE } from '@shared/locales';
import { isManualSequence } from '@shared/manual-tests';
import { mobilePlanTargets, type MobilePlanTarget } from '../mobile/mobile-plan-units';
import type { BrowserChoice } from '../runtime/browsers';
import type { Pass } from './browsers';
import type { FrozenTests, TestLink } from './definitions';

/**
 * Every test, on every browser that starts.
 *
 * A pass is the whole plan, API tests included: a plan is a flow, and the ids one of its
 * requests captured belong to the pass that captured them, not to the browser that ran
 * first.
 */
export interface RunUnit {
  browserChoice?: BrowserChoice;
  locale?: string;
  link: TestLink;
  bddRowIndex?: number;
  mobileTarget?: MobilePlanTarget;
}

export interface Lane {
  browserChoice: Pass;
  units: RunUnit[];
  /** What the lane's tests captured so far, starting with its {{locale}}. */
  captured: Record<string, string>;
}

const isCucumber = (tests: Pick<FrozenTests, 'ui'>, link: TestLink) =>
  link.testType === 'ui' && !!link.testId && tests.ui.get(link.testId)?.bdd?.mode === 'cucumber';

/** A plan of nothing but cucumber tests opens no browser of its own. */
export const onlyBdd = (tests: Pick<FrozenTests, 'links' | 'ui'>): boolean =>
  tests.links.length > 0 && tests.links.every((link) => isCucumber(tests, link));

/**
 * One lane per browser: the whole plan, in order, with its own captured values.
 *
 * A pass is an independent run of the plan, so what one browser's flow created belongs to
 * that browser's flow. Sharing the captured map across passes — which is what a single
 * shared object did — meant the second browser read the first one's ids and never exercised
 * its own creates.
 *
 * And one per language on each browser, when the plan names languages: each is a run of the
 * plan of its own, and starts with {{locale}} among its variables so UI and API tests can
 * both read it.
 */
export function planLanes(
  tests: Pick<FrozenTests, 'links' | 'ui' | 'mobile'>,
  usablePasses: Pass[],
  locales: string[] | null | undefined,
): Lane[] {
  const runLocales: Array<string | undefined> =
    locales && locales.length > 0 ? locales : [undefined];
  // A manual test is done once per run by a person, not once per browser and language: only the
  // first lane carries it, and its result names no browser.
  // So is a mobile app test: it runs on its own device, not in the plan's browsers.
  const isManualLink = (link: TestLink) =>
    link.testType === 'mobile' ||
    (link.testType === 'ui' &&
      !!link.testId &&
      (isCucumber(tests, link) || isManualSequence(tests.ui.get(link.testId)?.sequence)));
  const independentLinks = tests.links.filter(
    (link) => link.testType === 'mobile' || isCucumber(tests, link),
  );
  const lanePasses = usablePasses.length
    ? usablePasses
    : independentLinks.length
      ? [undefined]
      : [];
  return lanePasses.flatMap((browserChoice, browserIndex) =>
    runLocales.map((locale, localeIndex) => {
      const first = browserIndex === 0 && localeIndex === 0;
      return {
        browserChoice,
        units: (usablePasses.length ? tests.links : independentLinks)
          .filter((link) => first || !isManualLink(link))
          .flatMap((link): RunUnit[] => {
            if (link.testType === 'mobile' && link.mobileTestId) {
              const definition = tests.mobile.get(link.mobileTestId)?.test;
              return definition
                ? mobilePlanTargets(definition).map((mobileTarget) => ({ link, mobileTarget }))
                : [{ link }];
            }
            const test =
              link.testType === 'ui' && link.testId ? tests.ui.get(link.testId) : undefined;
            if (
              test?.bdd?.mode === 'cucumber' &&
              Array.isArray(test.dataset) &&
              test.dataset.length
            ) {
              return test.dataset.map((_row, bddRowIndex) => ({ link, bddRowIndex }));
            }
            return [isManualLink(link) ? { link } : { browserChoice, locale, link }];
          }),
        captured: (locale ? { [LOCALE_VARIABLE]: locale } : {}) as Record<string, string>,
      };
    }),
  );
}

/** Reads a jsonb column that came back as text, as these columns sometimes do. */
function safeJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether the tests in a lane have to stay in order.
 *
 * An extraction is what makes a plan a flow: the id the create returned is the id the
 * read-back needs. Those tests cannot be reordered or overlapped, and the plan that
 * declares them is saying so. Everything else is a list of independent checks.
 */
export function lanesAreChained(apiTests: Iterable<ApiTest>): boolean {
  return [...apiTests].some((apiTest) => {
    const extractions = apiTest.extractions;
    const parsed = typeof extractions === 'string' ? safeJsonArray(extractions) : extractions;
    return Array.isArray(parsed) && parsed.length > 0;
  });
}
