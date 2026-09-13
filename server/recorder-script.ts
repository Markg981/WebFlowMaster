/**
 * The script injected into every document of a recording session.
 *
 * It is installed with `context.addInitScript()` (not `page.addScriptTag()`), so it re-runs
 * on every navigation and in every page of the context. The previous script-tag injection
 * died on the first full page load, which silently truncated every multi-page recording.
 *
 * Kept as a plain string on purpose:
 *  - esbuild's `keepNames` wraps named functions in a `__name()` helper that only exists in
 *    the Node bundle, so passing a real function to Playwright breaks in the browser;
 *  - it makes the browser-side code obvious rather than something TypeScript might reshape.
 *
 * Deliberately avoids template literals so the outer TS template literal needs no escaping.
 */
import { VOLATILE_ID_PATTERNS } from '@shared/selectors';

export const RECORDER_SCRIPT = `
(function () {
  if (window.__wfmRecorderInstalled) return;
  window.__wfmRecorderInstalled = true;

  // Interpolated, not duplicated: the same list element detection uses. JSON is a valid JS
  // array literal, so this needs no escaping beyond what JSON.stringify already does.
  var VOLATILE_ID_PATTERNS = ${JSON.stringify(VOLATILE_ID_PATTERNS)};

  var IGNORE_SELECTOR = '[data-wfm-recorder]';
  var ASSERT_MODE_KEY = '__wfm_assert_mode';
  var HIGHLIGHT_STYLE = '2px solid #ef4444';

  var pendingActions = [];
  var actionCount = 0;

  function flushPending() {
    if (typeof window.__wfmRecordAction !== 'function') return;
    while (pendingActions.length) {
      try { window.__wfmRecordAction(pendingActions.shift()); } catch (e) { return; }
    }
  }

  function send(action) {
    actionCount++;
    updateCounter();
    if (typeof window.__wfmRecordAction === 'function') {
      try { window.__wfmRecordAction(action); } catch (e) { /* page tearing down */ }
    } else {
      // The binding is installed just before init scripts, but never assume: buffer and retry.
      pendingActions.push(action);
      setTimeout(flushPending, 50);
    }
  }

  function isRecorderUi(el) {
    return !!(el && el.closest && el.closest(IGNORE_SELECTOR));
  }

  function isIgnored(el) {
    return !!(el && el.closest && el.closest('[data-webtest-platform-ignore="true"]'));
  }

  // Values from password-like fields must never leave the browser: they would be stored in
  // the test sequence in clear text and replayed from the database.
  function isSecretField(el) {
    if (!el) return false;
    if (String(el.type || '').toLowerCase() === 'password') return true;
    var haystack = [
      el.name, el.id, el.getAttribute && el.getAttribute('autocomplete'),
      el.getAttribute && el.getAttribute('aria-label')
    ].join(' ').toLowerCase();
    return /pass|secret|token|apikey|api-key|otp|cvv|\\bpin\\b/.test(haystack);
  }

  // Rebuilt from the shared patterns rather than written twice; see shared/selectors.ts.
  var VOLATILE_ID_RES = VOLATILE_ID_PATTERNS.map(function (p) { return new RegExp(p, 'i'); });

  function isVolatileId(id) {
    for (var vi = 0; vi < VOLATILE_ID_RES.length; vi++) {
      if (VOLATILE_ID_RES[vi].test(id)) return true;
    }
    return false;
  }

  /** A unique id a developer chose. A generated one is worse than no id at all. */
  function usableId(el) {
    if (!el || !el.id) return null;
    if (isVolatileId(el.id)) return null;
    try {
      if (document.querySelectorAll('#' + CSS.escape(el.id)).length !== 1) return null;
    } catch (e) { return null; }
    return '#' + CSS.escape(el.id);
  }

  function generateSelector(el) {
    try {
      if (!el || !(el instanceof Element)) return null;

      // Before the id: a test id is something someone wrote down on purpose, and an id can
      // be an accident of the framework. This order used to be the other way round.
      var testId = el.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId + '"]';
      var testAttr = el.getAttribute('data-test');
      if (testAttr) return '[data-test="' + testAttr + '"]';

      var ownId = usableId(el);
      if (ownId) return ownId;

      var tagName = el.tagName.toLowerCase();

      var nameAttr = el.getAttribute('name');
      if (nameAttr) {
        var byName = tagName + '[name="' + nameAttr + '"]';
        if (document.querySelectorAll(byName).length === 1) return byName;
      }

      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) {
        var byAria = tagName + '[aria-label="' + ariaLabel + '"]';
        if (document.querySelectorAll(byAria).length === 1) return byAria;
      }

      if (el.classList && el.classList.length > 0) {
        var significant = Array.prototype.filter.call(el.classList, function (cls) {
          return cls &&
            !/^(ng|cdk|mat)-/.test(cls) &&
            !/[:()\\[\\]/.]/.test(cls) &&
            !/(focus|active|hover|selected|touched|dirty|pristine)/i.test(cls);
        });
        for (var n = significant.length; n >= 1; n--) {
          var combined = tagName + '.' + significant.slice(0, n).join('.');
          try {
            if (document.querySelectorAll(combined).length === 1) return combined;
          } catch (e) { /* invalid selector, try a shorter one */ }
        }
      }

      // Its own words, before its position in the document.
      //
      // The last resort below walks up to the nearest named ancestor, and for anything inside
      // an overlay there is none — so it ends at body and the path begins
      // "body > div:nth-of-type(8)", which counts the overlay containers that happened to
      // exist at that moment. Replay opens a different number of them and clicks nothing.
      // A menu entry, a tab, a dialog button: each carries text a person chose, and Playwright
      // matches it directly. Element detection has always preferred this; the recorder went
      // straight from classes to geometry.
      var ownText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (ownText && ownText.length <= 60) {
        var matches = 0;
        var all = document.querySelectorAll(tagName);
        for (var t = 0; t < all.length && matches < 2; t++) {
          var candidateText = (all[t].innerText || all[t].textContent || '').replace(/\\s+/g, ' ').trim();
          if (candidateText === ownText) matches++;
        }
        // Only when it identifies exactly one element, or the step would be ambiguous and
        // Playwright would refuse to act on it.
        if (matches === 1) return tagName + ':text-is("' + ownText.replace(/"/g, '\\\\"') + '")';
      }

      // Structural fallback: nth-of-type path, stopping at the closest unique ancestor id.
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
        // The anchor matters as much as the leaf: a path rooted at #cdk-overlay-0 is exactly
        // as unreplayable as a leaf selector of #cdk-overlay-0, and that is where most of
        // them came from — an overlay is where a menu or a dialog lives.
        var anchor = usableId(node);
        if (anchor) {
          parts.unshift(anchor);
          break;
        }
        var part = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (parent) {
          var sameTag = Array.prototype.filter.call(parent.children, function (c) {
            return c.tagName === node.tagName;
          });
          if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    } catch (e) {
      return null;
    }
  }

  function getElementDetails(el) {
    if (!el || !(el instanceof Element)) return {};
    var textContent = el.innerText || el.textContent || '';
    if (el.value && !isSecretField(el)) textContent = el.value;
    return {
      targetTag: el.tagName.toLowerCase(),
      targetId: el.id || undefined,
      targetClass: typeof el.className === 'string' ? el.className : undefined,
      targetText: String(textContent).substring(0, 100).trim()
    };
  }

  /* ---------------------------------------------------------------- assert overlay */

  var panel = null;
  var hoveredEl = null;
  var previousOutline = '';
  var counterEl = null;

  function assertModeOn() {
    try { return sessionStorage.getItem(ASSERT_MODE_KEY) === '1'; } catch (e) { return false; }
  }

  function setAssertMode(on) {
    try { sessionStorage.setItem(ASSERT_MODE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    clearHighlight();
    closePanel();
    renderToolbar();
    document.documentElement.style.cursor = on ? 'crosshair' : '';
  }

  function clearHighlight() {
    if (hoveredEl) {
      hoveredEl.style.outline = previousOutline;
      hoveredEl = null;
    }
  }

  function highlight(el) {
    if (el === hoveredEl) return;
    clearHighlight();
    if (!el || isRecorderUi(el)) return;
    hoveredEl = el;
    previousOutline = el.style.outline;
    el.style.outline = HIGHLIGHT_STYLE;
  }

  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  function updateCounter() {
    if (counterEl) counterEl.textContent = String(actionCount);
  }

  function styled(tag, css, text) {
    var node = document.createElement(tag);
    node.style.cssText = css;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var TOOLBAR_CSS = 'position:fixed;top:12px;right:12px;z-index:2147483647;' +
    'font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;' +
    'background:#111827;border:1px solid #374151;border-radius:10px;padding:8px 10px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;';
  var BTN_CSS = 'font:12px/1 system-ui,sans-serif;padding:6px 10px;border-radius:6px;' +
    'border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;cursor:pointer;';
  var BTN_ACTIVE_CSS = 'font:12px/1 system-ui,sans-serif;padding:6px 10px;border-radius:6px;' +
    'border:1px solid #ef4444;background:#ef4444;color:#fff;cursor:pointer;';

  var toolbar = null;

  function renderToolbar() {
    if (!document.body) return;
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);

    toolbar = styled('div', TOOLBAR_CSS);
    toolbar.setAttribute('data-wfm-recorder', 'toolbar');

    var dot = styled('span', 'width:8px;height:8px;border-radius:50%;background:#ef4444;' +
      'display:inline-block;flex:none;');
    var label = styled('span', 'font-weight:600;letter-spacing:.02em;', 'REC');
    counterEl = styled('span', 'background:#374151;border-radius:999px;padding:2px 8px;' +
      'font-variant-numeric:tabular-nums;', String(actionCount));

    var assertBtn = styled('button', assertModeOn() ? BTN_ACTIVE_CSS : BTN_CSS,
      assertModeOn() ? 'Click an element…' : 'Add assert');
    assertBtn.type = 'button';
    assertBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setAssertMode(!assertModeOn());
    }, true);

    toolbar.appendChild(dot);
    toolbar.appendChild(label);
    toolbar.appendChild(counterEl);
    toolbar.appendChild(assertBtn);
    document.body.appendChild(toolbar);
  }

  var PANEL_CSS = 'position:fixed;z-index:2147483647;width:300px;' +
    'font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#e5e7eb;' +
    'background:#111827;border:1px solid #374151;border-radius:10px;padding:12px;' +
    'box-shadow:0 12px 32px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:8px;';
  var FIELD_CSS = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;' +
    'border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;font:12px system-ui,sans-serif;';

  function openAssertPanel(el, x, y) {
    closePanel();
    var selector = generateSelector(el);
    if (!selector) {
      window.alert('Could not build a stable selector for this element.');
      return;
    }

    var details = getElementDetails(el);
    var elementText = (details.targetText || '').trim();
    var matchCount = 1;
    try { matchCount = document.querySelectorAll(selector).length; } catch (e) { /* ignore */ }

    panel = styled('div', PANEL_CSS);
    panel.setAttribute('data-wfm-recorder', 'panel');
    panel.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    panel.style.top = Math.min(y, window.innerHeight - 260) + 'px';

    panel.appendChild(styled('div', 'font-weight:600;', 'Expected result'));
    panel.appendChild(styled('div',
      'font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9ca3af;' +
      'word-break:break-all;max-height:48px;overflow:auto;', selector));

    var typeSel = document.createElement('select');
    typeSel.style.cssText = FIELD_CSS;
    [
      ['assertTextContains', 'Contains the text'],
      ['assertElementCount', 'Number of matching elements'],
      ['assert', 'Element is visible']
    ].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      typeSel.appendChild(opt);
    });

    var valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.style.cssText = FIELD_CSS;
    valueInput.value = elementText;
    valueInput.placeholder = 'Expected text';

    function syncValueField() {
      if (typeSel.value === 'assertTextContains') {
        valueInput.style.display = '';
        valueInput.placeholder = 'Expected text';
        valueInput.value = elementText;
      } else if (typeSel.value === 'assertElementCount') {
        valueInput.style.display = '';
        valueInput.placeholder = 'e.g. ==1, >=2';
        valueInput.value = '==' + matchCount;
      } else {
        valueInput.style.display = 'none';
        valueInput.value = '';
      }
    }
    typeSel.addEventListener('change', syncValueField, true);
    syncValueField();

    panel.appendChild(typeSel);
    panel.appendChild(valueInput);

    var row = styled('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:2px;');
    var cancel = styled('button', BTN_CSS, 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      closePanel();
      setAssertMode(false);
    }, true);

    var save = styled('button', BTN_ACTIVE_CSS, 'Add assert');
    save.type = 'button';
    save.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var kind = typeSel.value;
      var value = valueInput.value;
      if (kind !== 'assert' && !String(value).trim()) {
        valueInput.style.borderColor = '#ef4444';
        return;
      }
      send({
        type: kind,
        selector: selector,
        value: kind === 'assert' ? null : value,
        timestamp: Date.now(),
        url: window.location.href,
        targetTag: details.targetTag,
        targetId: details.targetId,
        targetClass: details.targetClass,
        targetText: details.targetText
      });
      closePanel();
      setAssertMode(false);
    }, true);

    row.appendChild(cancel);
    row.appendChild(save);
    panel.appendChild(row);
    document.body.appendChild(panel);
    if (typeSel.value !== 'assert') valueInput.focus();
  }

  /* --------------------------------------------------------------------- listeners */

  // Registered first so that, in assert mode, it swallows the click before the recorder
  // below can log it as a normal interaction step.
  document.addEventListener('click', function (event) {
    if (!assertModeOn()) return;
    var el = event.target;
    if (isRecorderUi(el)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    clearHighlight();
    openAssertPanel(el, event.clientX + 8, event.clientY + 8);
  }, true);

  document.addEventListener('mouseover', function (event) {
    if (!assertModeOn()) return;
    highlight(event.target);
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && assertModeOn()) {
      event.preventDefault();
      event.stopPropagation();
      setAssertMode(false);
    }
  }, true);

  /**
   * Hovers that revealed something, and only those.
   *
   * A flyout menu opens on mouseover and closes when the pointer leaves, so the click that
   * follows it is on an element that does not exist on a freshly loaded page — replay times
   * out on the first step. Recording every mouseover would drown the test; recording none
   * loses the step that matters.
   *
   * So: remember what the pointer was over each time a subtree appears under it, and turn
   * that into a hover step only if the next click lands INSIDE the subtree that appeared.
   * A tooltip nobody clicks is forgotten; the menu you then pick an item from is kept.
   */
  var lastHovered = null;
  var pendingHovers = [];
  var PENDING_HOVER_TTL_MS = 15000;

  document.addEventListener('mouseover', function (event) {
    var el = event.target;
    if (el && el instanceof Element && !isRecorderUi(el)) lastHovered = el;
  }, true);

  // Observed on the Document node, NOT on document.documentElement: this script is installed
  // with addInitScript and therefore runs before the page has an html element, so observing
  // the element throws — and, swallowed by the catch below, leaves no hover steps and no sign
  // of why. The Document is there from the start and its subtree is the same one.
  //
  // (And no backticks in here: this whole script is one TypeScript template literal, as the
  // note at the top of the file says. One in a comment ends the string and the build fails.)
  try {
    new MutationObserver(function (records) {
      if (!lastHovered) return;
      var now = Date.now();
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var a = 0; a < added.length; a++) {
          var node = added[a];
          if (!node || node.nodeType !== 1 || isRecorderUi(node)) continue;
          // The pointer cannot have revealed something it is already inside.
          if (node.contains(lastHovered)) continue;
          pendingHovers.push({ host: lastHovered, root: node, at: now });
        }
      }
      // Bounded, so a busy page cannot grow this without limit.
      pendingHovers = pendingHovers.filter(function (p) { return now - p.at < PENDING_HOVER_TTL_MS; }).slice(-40);
    }).observe(document, { childList: true, subtree: true });
    // Says so, rather than leaving "no hover steps" to mean either "nothing to capture" or
    // "the capture never started". The catch below swallowed a real failure once and the
    // only symptom was an absence, which is the hardest kind of bug to look for.
    window.__wfmRecorderHoverWatch = true;
  } catch (e) {
    window.__wfmRecorderHoverWatch = 'failed: ' + (e && e.message ? e.message : String(e));
    // Visible in the recording window's console; the rest of the recorder is unaffected.
    try { console.warn('[wfm recorder] hover capture unavailable:', e); } catch (e2) { /* ignore */ }
  }

  /** The hover that revealed the thing just clicked, if there was one. */
  function hoverThatRevealed(clicked) {
    var now = Date.now();
    for (var i = pendingHovers.length - 1; i >= 0; i--) {
      var p = pendingHovers[i];
      if (now - p.at >= PENDING_HOVER_TTL_MS) continue;
      if (p.root.contains(clicked) && !p.host.contains(clicked)) return p.host;
    }
    return null;
  }

  var lastHoverSelectorSent = null;

  document.addEventListener('click', function (event) {
    try {
      var el = event.target;
      if (!el || !(el instanceof Element) || isRecorderUi(el) || isIgnored(el)) return;

      var selector = generateSelector(el);
      if (!selector) return;

      var host = hoverThatRevealed(el);
      if (host) {
        var hostSelector = generateSelector(host);
        // Not the same one twice running: picking two items from one menu is one hover.
        if (hostSelector && hostSelector !== lastHoverSelectorSent) {
          var hoverAction = {
            type: 'hover',
            selector: hostSelector,
            timestamp: Date.now(),
            url: window.location.href
          };
          var hostDetails = getElementDetails(host);
          for (var hk in hostDetails) hoverAction[hk] = hostDetails[hk];
          send(hoverAction);
          lastHoverSelectorSent = hostSelector;
        }
      } else {
        lastHoverSelectorSent = null;
      }
      pendingHovers = [];

      var action = {
        type: 'click',
        selector: selector,
        timestamp: Date.now(),
        url: window.location.href
      };
      var details = getElementDetails(el);
      for (var k in details) action[k] = details[k];
      send(action);
    } catch (e) { /* never break the page under test */ }
  }, true);

  document.addEventListener('change', function (event) {
    try {
      var el = event.target;
      if (!el || !(el instanceof Element)) return;
      var tag = el.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].indexOf(tag) === -1) return;
      if (el.type === 'hidden' || isRecorderUi(el) || isIgnored(el)) return;

      var selector = generateSelector(el);
      if (!selector) return;

      var secret = isSecretField(el);
      var value = el.value;
      if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? 'true' : 'false';

      var action = {
        type: tag === 'select' ? 'select' : 'input',
        selector: selector,
        value: secret ? '' : value,
        masked: secret || undefined,
        timestamp: Date.now(),
        url: window.location.href
      };
      var details = getElementDetails(el);
      for (var k in details) action[k] = details[k];
      send(action);
    } catch (e) { /* never break the page under test */ }
  }, true);

  document.addEventListener('keydown', function (event) {
    try {
      if (event.key !== 'Enter') return;
      var el = event.target;
      if (!el || !(el instanceof Element) || isRecorderUi(el) || isIgnored(el)) return;
      send({
        type: 'keypress',
        key: 'Enter',
        selector: generateSelector(el),
        timestamp: Date.now(),
        url: window.location.href
      });
    } catch (e) { /* ignore */ }
  }, true);

  /* ------------------------------------------------------------------- navigations */

  function reportNavigation() {
    send({ type: 'navigate', url: window.location.href, value: window.location.href, timestamp: Date.now() });
  }

  // Full document loads: this init script runs again, so reporting here covers them.
  reportNavigation();

  // SPA route changes never reload the document, so hook the History API too.
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      setTimeout(reportNavigation, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(reportNavigation, 0); }, true);
  window.addEventListener('hashchange', function () { setTimeout(reportNavigation, 0); }, true);

  /* -------------------------------------------------------------------- bootstrap */

  if (document.body) {
    renderToolbar();
    if (assertModeOn()) document.documentElement.style.cursor = 'crosshair';
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      renderToolbar();
      if (assertModeOn()) document.documentElement.style.cursor = 'crosshair';
    }, { once: true });
  }
})();
`;
