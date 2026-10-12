import { VOLATILE_ID_PATTERNS } from '@shared/selectors';
import { Frame, Page } from 'playwright';
import { throwIfEgressDenied } from '../../egress-policy';
import { substituteVariables } from '../../outbound-http';
import { storage } from '../../identity/storage';

import {
  AUTHORING_USER_AGENT,
  DEFAULT_ENGINE,
  browserForSetting,
  openBrowserSession,
} from '../browser-session';
import { describeBrowser } from '../../browsers';
import { resolvedLogger } from './log';
import { scopeFor } from './run-helpers';
import {
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT,
  DEFAULT_WAIT_TIME,
  type DetectedElement,
  type DetectionResult,
  type DetectionSummary,
} from './types';

/**
 * How many detected elements to return.
 *
 * Was a hard-coded 50, which is plenty for a landing page and a fraction of a DMO grid —
 * and it truncated silently, so the Detected Elements panel looked complete while missing
 * most of the page. The cap still exists (an unbounded list would be unusable in the UI and
 * slow to verify), but it is raised, configurable, and reported: see lastDetectionSummary.
 */
function detectionLimit(): number {
  const configured = parseInt(process.env.ELEMENT_DETECTION_LIMIT || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 300;
}

/**
 * Collects the interactive elements of ONE document — a frame, not necessarily the page.
 *
 * Module-level because it is now run once per frame rather than once per page: an element
 * inside an iframe was invisible to detection entirely, since page.evaluate only reaches the
 * top document and page.locator does not cross the boundary either.
 */
function collectCandidatesInFrame(volatileIdPatterns: readonly string[]) {
  // esbuild/tsx (keepNames) wraps named functions in `__name(fn, "…")`; that helper only
  // exists in the Node bundle, so provide a harmless identity shim for the browser page.
  (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);

  const interactiveSelectors = [
    'input:not([type="hidden"])',
    'button',
    'a[href]',
    'select',
    'textarea',
    '[onclick]',
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])',
    'h1, h2, h3, h4, h5, h6',
    'img[alt]',
    'form',
    '[data-testid]',
    '[data-test]',
  ];

  /**
   * Ids a framework generated rather than a developer chose.
   *
   * Angular Material stamps `mat-input-3`, `mat-select-value-5`, `mat-button-9` in render
   * order, so they shift as soon as anything above the element changes. Radix and React's
   * useId produce `:r1a:`. Preferring one of these over a label is what makes a recorded
   * test fail the next day against an application nobody touched.
   *
   * The rule itself now lives in shared/selectors.ts and arrives as an argument, because
   * the recorder needs exactly the same one and had a weaker one of its own — which is
   * how a recording of an Angular Material application came back anchored on
   * `#cdk-overlay-0` and could not be replayed even once.
   */
  const volatileIdRes = volatileIdPatterns.map((pattern) => new RegExp(pattern, 'i'));
  const isVolatileId = (id: string) => volatileIdRes.some((re) => re.test(id));

  /**
   * Every document-like root, including open shadow roots.
   *
   * querySelectorAll stops at a shadow boundary; Playwright's CSS engine pierces open
   * roots on its own. Walking only the light DOM therefore left the element missing from
   * the list while being perfectly clickable — and made the uniqueness check disagree
   * with the engine that would later act on the selector.
   */
  const roots: Array<Document | ShadowRoot> = [document];
  (function collectRoots(root: Document | ShadowRoot) {
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        collectRoots(el.shadowRoot);
      }
    });
  })(document);

  const queryAll = (sel: string): Element[] =>
    roots.flatMap((root) => {
      try {
        return Array.from(root.querySelectorAll(sel));
      } catch {
        return [];
      }
    });

  const isUnique = (sel: string) => queryAll(sel).length === 1;

  const isVolatileClass = (c: string) =>
    !c ||
    /[:()[\]/.]/.test(c) ||
    /^(ng|cdk|mat|mdc)-/.test(c) ||
    /(focus|active|hover|selected|touched|dirty|pristine|disabled|expanded)/i.test(c);

  const structuralPath = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      if (node.id && !isVolatileId(node.id) && isUnique(`#${CSS.escape(node.id)}`)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };

  /**
   * The first CSS selector that identifies this element on its own, or null.
   *
   * Ordered by how long the thing it keys on tends to survive: a developer-chosen id,
   * then a test id, then the accessible label, then non-framework classes. A generated id
   * is skipped rather than ranked last, because it looks perfectly unique today — which
   * is exactly why it used to win.
   */
  const buildCssSelector = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase();

    if (el.id && !isVolatileId(el.id) && isUnique(`#${CSS.escape(el.id)}`)) {
      return `#${CSS.escape(el.id)}`;
    }
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) {
        const s = `${tag}[${attr}="${v.replace(/[\\"]/g, '\\$&')}"]`;
        if (isUnique(s)) return s;
      }
    }
    if (typeof el.className === 'string' && el.className.trim()) {
      const classes = el.className.split(/\s+/).filter((c) => !isVolatileClass(c));
      for (let n = classes.length; n >= 1; n--) {
        const s = `${tag}.${classes.slice(0, n).join('.')}`;
        if (isUnique(s)) return s;
      }
    }
    return null;
  };

  /** The ARIA role: explicit, or the obvious one implied by the tag. */
  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      if (['text', 'email', 'tel', 'url', 'password', 'search'].indexOf(type) !== -1)
        return 'textbox';
    }
    return null;
  };

  /** Close enough to the accessible name for Playwright's `role=…[name=…]` engine. */
  const accessibleNameOf = (el: Element): string | null => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 80) return text;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    return null;
  };

  /**
   * What a person would call a control that shows no text of its own — a field is named by
   * its <label>, not by what is typed in it.
   *
   * Without this a login form's inputs were listed as "input-0" and "input-1": the element list
   * said nothing useful, and "Type tomsmith in the Username field" found nothing called
   * Username. The invented name is still the last resort.
   */
  const nameOfControl = (el: Element): string => {
    const clean = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ');
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const byText = labelledBy
        .split(/\s+/)
        .map((id) => clean(el.ownerDocument.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(' ');
      if (byText) return byText;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) {
      const byLabel = Array.from(labels)
        .map((label) => clean(label.textContent))
        .filter(Boolean)
        .join(' ');
      if (byLabel) return byLabel;
    }
    return clean(el.getAttribute('title')) || clean(el.getAttribute('name')) || clean(el.id);
  };

  const detectedElements: any[] = [];
  const seen = new Set<Element>();
  let globalElementCounter = 0;

  interactiveSelectors.forEach((selector) => {
    queryAll(selector).forEach((element, index) => {
      if (seen.has(element)) return; // an element can match several selectors — keep one entry
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      seen.add(element);

      const tagName = element.tagName.toLowerCase();
      const text = element.textContent?.trim() || '';
      const placeholder = element.getAttribute('placeholder') || '';
      const displayText =
        text ||
        placeholder ||
        element.getAttribute('alt') ||
        nameOfControl(element) ||
        `${tagName}-${index}`;
      let elementType = 'element';
      if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
      else if (tagName === 'button' || element.getAttribute('role') === 'button')
        elementType = 'button';
      else if (tagName === 'a') elementType = 'link';
      else if (tagName.match(/h[1-6]/)) elementType = 'heading';
      else if (tagName === 'select') elementType = 'select';
      else if (tagName === 'textarea') elementType = 'textarea';
      const attributes: Record<string, string> = {};
      Array.from(element.attributes).forEach((attr: any) => {
        attributes[attr.name] = attr.value;
      });

      const exactText = text.replace(/\s+/g, ' ').trim();

      detectedElements.push({
        id: `elem-${tagName}-${globalElementCounter++}`,
        type: elementType,
        text: displayText.substring(0, 100),
        tag: tagName,
        attributes,
        // Document-relative, not viewport-relative: the preview is a full-page
        // screenshot, and an element below the fold has to be drawable on it.
        boundingBox: {
          x: Math.round(rect.x + window.scrollX),
          y: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        cssSelector: buildCssSelector(element),
        role: roleOf(element),
        accessibleName: accessibleNameOf(element),
        exactText: exactText && exactText.length <= 80 ? exactText : null,
        structuralPath: structuralPath(element),
      });
    });
  });

  /**
   * Then text a test would verify: an element carrying words of its own.
   *
   * Only interactive elements used to be collected, so a page of plain text — the frames of
   * /nested_frames are nothing but a word each — detected nothing at all, and "Verify text"
   * had no element to point at. Listed after the interactive ones, so the truncation limit
   * drops text before it drops a field or a button; and skipped inside an element already
   * listed, whose own text is the label of that button or link.
   */
  const nonText = new Set([
    'script',
    'style',
    'noscript',
    'template',
    'title',
    'option',
    'head',
    'html',
  ]);
  const ownText = (el: Element) =>
    Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const insideListed = (el: Element) => {
    for (let node = el.parentElement; node; node = node.parentElement)
      if (seen.has(node)) return true;
    return false;
  };
  const textCandidates = document.body
    ? [document.body, ...queryAll('body *')]
    : queryAll('body *');
  textCandidates.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (seen.has(element) || nonText.has(tagName)) return;
    const own = ownText(element);
    if (!own || insideListed(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    seen.add(element);

    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    const attributes: Record<string, string> = {};
    Array.from(element.attributes).forEach((attr: any) => {
      attributes[attr.name] = attr.value;
    });

    detectedElements.push({
      id: `elem-${tagName}-${globalElementCounter++}`,
      type: 'content',
      text: (text || own).substring(0, 100),
      tag: tagName,
      attributes,
      boundingBox: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      cssSelector: buildCssSelector(element),
      role: roleOf(element),
      accessibleName: accessibleNameOf(element),
      exactText: text && text.length <= 80 ? text : null,
      structuralPath: structuralPath(element),
    });
  });

  return {
    elements: detectedElements,
    totalFound: detectedElements.length,
    pageSize: {
      width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
      height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
    },
  };
}

export class ElementDetectionService {
  /**
   * Set by every detection run. Read by the routes so the interface can say "showing 300 of
   * 812" instead of presenting a truncated list as if it were the whole page.
   */
  private lastDetectionSummary: DetectionSummary | undefined;

  getLastDetectionSummary(): DetectionSummary | undefined {
    return this.lastDetectionSummary;
  }

  /**
   * Opens the user's browser on a page and waits for it to settle: where both loading a page
   * and detecting its elements start from, so the preview and the element list see one render.
   */
  private async openSettledPage(url: string, userId: number | undefined, label: string) {
    const targetUrl = substituteVariables(url);
    const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
    const headlessMode = userSettings?.playwrightHeadless ?? DEFAULT_HEADLESS;
    const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
    const waitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
    const browser = browserForSetting(userSettings?.playwrightBrowser, headlessMode);
    resolvedLogger.debug({
      message: `PS:${label} - Effective settings`,
      browser: describeBrowser(browser),
      pageTimeout,
      waitTime,
      userId,
    });

    const session = await openBrowserSession({
      browser,
      url: targetUrl,
      userAgent: AUTHORING_USER_AGENT,
      timeoutMs: pageTimeout,
    });
    try {
      throwIfEgressDenied(await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }));
      // SPA frameworks (Angular/DevExpress, React, …) render their content after
      // domcontentloaded, so a fixed short wait captures an empty shell. Wait for the
      // network to go idle first; if it never settles (long-polling/websockets), fall
      // back to the fixed wait rather than failing.
      await session.page.waitForLoadState('networkidle', { timeout: pageTimeout }).catch(() => {
        resolvedLogger.debug({
          message: `PS:${label} - networkidle not reached, proceeding after fixed wait`,
          url,
        });
      });
      await session.page.waitForTimeout(waitTime);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  async loadWebsite(
    url: string,
    userId?: number,
  ): Promise<{ success: boolean; screenshot?: string; html?: string; error?: string }> {
    resolvedLogger.http({ message: 'PlaywrightService: loadWebsite called', url, userId });
    try {
      await using session = await this.openSettledPage(url, userId, 'loadWebsite');
      const html = await session.page.content();
      const screenshotBuffer = await session.page.screenshot({ type: 'png', fullPage: false });
      return {
        success: true,
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        html,
      };
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error loading website',
        url,
        userId,
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Scans the current page for interactive elements and returns them with GUARANTEED
   * unique CSS selectors (id → stable attribute → non-transient class combo → nth-of-type
   * structural path). Single source of truth for element detection — used by both
   * detectElements() and the post-run detection inside executeAdhocSequence(), so the two
   * never drift apart (previously they did: execution produced non-unique class selectors
   * like `button.mat-mdc-menu-item`, which Playwright could not click unambiguously).
   */
  /**
   * How to address a frame from the top document: ' >> ' separated, outermost first.
   *
   * Returns null when any link in the chain cannot be addressed. A frame with no id, no
   * name and no stable position is one whose elements could never be acted on, and
   * listing them would be a promise the runner cannot keep.
   */
  private async frameChainFor(frame: Frame): Promise<string | null> {
    const chain: string[] = [];
    let current: Frame | null = frame;

    while (current && current.parentFrame()) {
      let element;
      try {
        element = await current.frameElement();
      } catch {
        return null; // detached mid-scan
      }

      const selector = await element
        .evaluate((el: Element) => {
          const escape = (value: string) => (window as any).CSS.escape(value);
          const tag = el.tagName.toLowerCase(); // iframe, or the older frame
          const doc = el.ownerDocument!;
          const unique = (sel: string) => doc.querySelectorAll(sel).length === 1;

          if (el.id && unique(tag + '#' + escape(el.id))) return tag + '#' + escape(el.id);
          const name = el.getAttribute('name');
          if (name && unique(tag + '[name="' + name + '"]')) return tag + '[name="' + name + '"]';
          const title = el.getAttribute('title');
          if (title && unique(tag + '[title="' + title + '"]'))
            return tag + '[title="' + title + '"]';

          // Position among the same tag in its own document: stable as long as the
          // surrounding markup is, which is the same bargain the structural path makes.
          const index = Array.from(doc.querySelectorAll(tag)).indexOf(el);
          return index >= 0 ? tag + ' >> nth=' + index : null;
        })
        .catch(() => null);

      await element.dispose().catch(() => {});
      if (!selector) return null;

      chain.unshift(selector);
      current = current.parentFrame();
    }

    return chain.length > 0 ? chain.join(' >> ') : null;
  }

  /**
   * One reading of a page: what is on it, the picture it was measured on, and how much was
   * left out.
   *
   * The three travel together because they only mean anything together. The boxes are
   * document coordinates measured against a particular render, so drawing them on a
   * screenshot of a different moment puts the highlight on the wrong element; and a list
   * silently cut to the first N is a list the panel would present as the whole page.
   *
   * `detectElements` already did this. The builder's "Execute Test" — which is how the
   * element list follows the test into a dialog or onto the next page — did not: it took the
   * elements and left the picture and the count behind, so after a step opened a modal the
   * new boxes were drawn over the previous screenshot.
   */
  async surveyPage(page: Page): Promise<DetectionResult> {
    let elements: DetectedElement[] = [];
    try {
      elements = await this.detectElementsOnPage(page);
    } catch (evalError: any) {
      resolvedLogger.warn({
        message: 'PS:surveyPage - Evaluation failed',
        error: evalError.message,
      });
    }

    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: true });
    const summary = this.getLastDetectionSummary() ?? {
      totalFound: elements.length,
      returned: elements.length,
      truncated: false,
      pageSize: { width: 1280, height: 720 },
    };

    return {
      elements,
      screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
      summary,
    };
  }

  private async detectElementsOnPage(page: Page): Promise<DetectedElement[]> {
    // One pass per frame. page.frames() is flat and already includes nested ones, so a
    // frame three levels down is reached the same way as a direct child.
    const perFrame: Array<{
      frameSelector: string | null;
      offset: { x: number; y: number };
      data: any;
    }> = [];
    for (const frame of page.frames()) {
      let frameSelector: string | null = null;
      let offset = { x: 0, y: 0 };
      if (frame !== page.mainFrame()) {
        frameSelector = await this.frameChainFor(frame);
        // A frame whose own <iframe> cannot be addressed from its parent is one whose
        // elements could never be acted on, so reporting them would be a false promise.
        if (!frameSelector) continue;
        // A frame measures its elements from its own corner; the preview is a screenshot of
        // the page. Shifted by where the frame sits, so a box is drawn on its element rather
        // than in the page's top-left corner.
        const box = await frame
          .frameElement()
          .then(async (el) => {
            const measured = await el.boundingBox();
            await el.dispose().catch(() => {});
            return measured;
          })
          .catch(() => null);
        if (box) offset = { x: Math.round(box.x), y: Math.round(box.y) };
      }
      try {
        perFrame.push({
          frameSelector,
          offset,
          // The patterns travel as data: this function is serialised into the page, so it
          // cannot close over the import. See shared/selectors.ts.
          data: await frame.evaluate(collectCandidatesInFrame, VOLATILE_ID_PATTERNS),
        });
      } catch {
        // A frame can navigate or detach mid-scan, and a cross-origin one cannot be read
        // at all. Neither is a reason to fail the whole detection.
      }
    }

    const candidates = {
      elements: perFrame.flatMap((f) =>
        f.data.elements.map((e: any) => ({
          ...e,
          frameSelector: f.frameSelector,
          boundingBox: e.boundingBox && {
            ...e.boundingBox,
            x: e.boundingBox.x + f.offset.x,
            y: e.boundingBox.y + f.offset.y,
          },
        })),
      ),
      totalFound: perFrame.reduce((n, f) => n + f.data.totalFound, 0),
      // The top document decides the picture the highlighting is drawn on.
      pageSize: perFrame[0]?.data.pageSize ?? { width: 1280, height: 720 },
    };

    const limit = detectionLimit();
    const chosen: DetectedElement[] = [];

    for (const candidate of candidates.elements.slice(0, limit)) {
      chosen.push({
        id: candidate.id,
        type: candidate.type,
        selector: await this.pickSelector(page, candidate),
        // Which frame that selector is relative to, so the step can be replayed.
        frameSelector: candidate.frameSelector ?? null,
        text: candidate.text,
        tag: candidate.tag,
        attributes: candidate.attributes,
        boundingBox: candidate.boundingBox,
      });
    }

    if (candidates.totalFound > limit) {
      resolvedLogger.info({
        message: 'PS:detectElementsOnPage - element list truncated',
        totalFound: candidates.totalFound,
        returned: chosen.length,
        limit,
      });
    }

    this.lastDetectionSummary = {
      totalFound: candidates.totalFound,
      returned: chosen.length,
      truncated: candidates.totalFound > limit,
      pageSize: candidates.pageSize,
    };

    return chosen;
  }

  /**
   * Chooses the selector to store for a detected element.
   *
   * CSS candidates were already checked for uniqueness inside the page, where it costs one
   * `querySelectorAll`. Playwright's own engines — `role=` and `text=` — cannot be evaluated
   * there, so they are verified here, and only for the elements that had no unique CSS. That
   * keeps the round-trips proportional to the awkward elements rather than to all of them.
   */
  private async pickSelector(
    page: Page,
    candidate: {
      cssSelector: string | null;
      role: string | null;
      accessibleName: string | null;
      exactText: string | null;
      structuralPath: string;
      frameSelector?: string | null;
    },
  ): Promise<string> {
    if (candidate.cssSelector) return candidate.cssSelector;

    // Counted inside the frame the element lives in. Against the top document a selector
    // unique in its own frame would look like zero matches, and lose to the structural
    // path for no reason.
    const scope = scopeFor(page, candidate.frameSelector);

    const engineCandidates: string[] = [];
    if (candidate.role && candidate.accessibleName) {
      engineCandidates.push(
        `role=${candidate.role}[name=${JSON.stringify(candidate.accessibleName)}]`,
      );
    }
    if (candidate.exactText) {
      engineCandidates.push(`text=${JSON.stringify(candidate.exactText)}`);
    }

    for (const selector of engineCandidates) {
      try {
        if ((await scope.locator(selector).count()) === 1) return selector;
      } catch {
        // An unusable selector is simply a candidate that lost.
      }
    }

    // Last resort: brittle against markup changes, but unambiguous today, which is the
    // property the engine needs in order to act at all.
    return candidate.structuralPath;
  }

  /**
   * How many elements each selector matches on a page.
   *
   * A selector matching zero or several elements cannot be clicked, and discovering that
   * during replay instead of during authoring is the expensive order of events.
   */
  async countSelectorMatches(
    url: string,
    selectors: string[],
  ): Promise<Array<{ selector: string; count: number }>> {
    const targetUrl = substituteVariables(url);
    await using session = await openBrowserSession({
      browser: browserForSetting(DEFAULT_ENGINE, true),
      url: targetUrl,
    });
    const { page } = session;
    throwIfEgressDenied(await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }));
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const results: Array<{ selector: string; count: number }> = [];
    for (const selector of selectors) {
      let count = -1;
      try {
        count = await page.locator(selector).count();
      } catch {
        count = -1; // malformed selector: reported, not thrown
      }
      results.push({ selector, count });
    }
    return results;
  }

  async detectElements(url: string, userId?: number): Promise<DetectionResult> {
    resolvedLogger.http({ message: 'PlaywrightService: detectElements called', url, userId });
    try {
      await using session = await this.openSettledPage(url, userId, 'detectElements');
      const detection = await this.surveyPage(session.page);
      resolvedLogger.info({
        message: `PS:detectElements - Element detection script completed.`,
        foundCount: detection.elements.length,
        url,
        userId,
      });
      return detection;
    } catch (error: any) {
      resolvedLogger.error({
        message: 'PS:detectElements - Error caught during element detection',
        url,
        userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
