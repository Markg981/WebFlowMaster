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
    // Where the element lives, said once for every action that targets one: the frame chain
    // replay enters before resolving the selector, or why there is none it could enter.
    if (action.type !== 'navigate') {
      var where = frameContext();
      if (where.frameSelector) action.frameSelector = where.frameSelector;
      if (where.unsupported && !action.unsupported) action.unsupported = where.unsupported;
    }
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

  /* -------------------------------------------------------------------- shadow DOM */

  // The engine replays with Playwright's CSS engine, which pierces OPEN shadow roots and stops
  // at closed ones. Everything below follows that rule, so what the recorder can see and what
  // replay can resolve are the same set of elements:
  //  - the element acted on is the first node of the composed path, not event.target, which
  //    the browser retargets to the outermost host by the time the event reaches document;
  //  - a selector is unique when it is unique across every open root, as the engine counts;
  //  - an element in a shadow root is addressed as "host-selector inner-selector": the
  //    descendant combinator crosses the boundary in the engine, so the shadow path stays one
  //    CSS selector and never uses the ' >> ' that separates the steps of a FRAME path;
  //  - a closed root is reported as unsupported, never recorded as a guess on its host.
  var closedHosts = new WeakSet();
  var hookedRoots = new WeakSet();
  var seenChanges = new WeakSet();

  function isShadowRoot(node) {
    return !!(node && node.nodeType === 11 && node.host);
  }

  /** The parent across a shadow boundary: a root's top-level children belong to its host. */
  function composedParent(node) {
    var parent = node.parentNode;
    return isShadowRoot(parent) ? parent.host : parent;
  }

  function composedContains(ancestor, node) {
    while (node) {
      if (node === ancestor) return true;
      node = composedParent(node);
    }
    return false;
  }

  function closestComposed(el, selector) {
    var node = el;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = composedParent(node);
    }
    return null;
  }

  /** What was actually acted on, through any number of open roots. */
  function deepTarget(event) {
    var path = event.composedPath ? event.composedPath() : null;
    var node = path && path.length ? path[0] : event.target;
    while (node && node.nodeType !== 1) node = isShadowRoot(node) ? node.host : node.parentNode;
    return node || null;
  }

  /** The scope itself (document or host) and every open root inside it, outermost first. */
  function searchRoots(scope) {
    var roots = [scope];
    if (scope.nodeType === 1 && scope.shadowRoot) roots.push(scope.shadowRoot);
    for (var i = 0; i < roots.length; i++) {
      var all = roots[i].querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) roots.push(all[j].shadowRoot);
      }
    }
    return roots;
  }

  function deepQueryAll(roots, selector) {
    var out = [];
    for (var i = 0; i < roots.length; i++) {
      var found = roots[i].querySelectorAll(selector);
      for (var j = 0; j < found.length; j++) out.push(found[j]);
    }
    return out;
  }

  function isRecorderUi(el) {
    return !!(el && el.nodeType === 1 && closestComposed(el, IGNORE_SELECTOR));
  }

  function isIgnored(el) {
    return !!(el && el.nodeType === 1 && closestComposed(el, '[data-webtest-platform-ignore="true"]'));
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
    return /pass|secret|token|apikey|api-key|otp|one-time-code|cc-|cvv|cvc|\\bssn\\b|\\bpin\\b/.test(haystack);
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
  function usableId(el, roots) {
    if (!el || !el.id) return null;
    if (isVolatileId(el.id)) return null;
    try {
      if (deepQueryAll(roots, '#' + CSS.escape(el.id)).length !== 1) return null;
    } catch (e) { return null; }
    return '#' + CSS.escape(el.id);
  }

  /**
   * A selector the engine resolves to this element and nothing else.
   *
   * Inside an open shadow root it is the host's selector, a space, and a selector unique
   * within that host: ids, names and positions are only meaningful inside their own root,
   * and the engine evaluates the descendant combinator across the boundary.
   */
  function generateSelector(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      var root = el.getRootNode ? el.getRootNode() : document;
      if (isShadowRoot(root)) {
        if (closedHosts.has(root.host)) return null;
        var hostSelector = generateSelector(root.host);
        var inner = selectorWithin(el, root.host);
        return hostSelector && inner ? hostSelector + ' ' + inner : null;
      }
      return selectorWithin(el, document);
    } catch (e) {
      return null;
    }
  }

  function selectorWithin(el, scope) {
    try {
      var roots = searchRoots(scope);
      var unique = function (selector) {
        return deepQueryAll(roots, selector).length === 1;
      };

      // Before the id: a test id is something someone wrote down on purpose, and an id can
      // be an accident of the framework. This order used to be the other way round.
      var testId = el.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId + '"]';
      var testAttr = el.getAttribute('data-test');
      if (testAttr) return '[data-test="' + testAttr + '"]';

      var ownId = usableId(el, roots);
      if (ownId) return ownId;

      var tagName = el.tagName.toLowerCase();

      var nameAttr = el.getAttribute('name');
      if (nameAttr) {
        var byName = tagName + '[name="' + nameAttr + '"]';
        if (unique(byName)) return byName;
      }

      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) {
        var byAria = tagName + '[aria-label="' + ariaLabel + '"]';
        if (unique(byAria)) return byAria;
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
            if (unique(combined)) return combined;
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
      var ownText = ownTextOf(el);
      if (ownText && ownText.length <= 60) {
        var matches = 0;
        var all = deepQueryAll(roots, tagName);
        for (var t = 0; t < all.length && matches < 2; t++) {
          if (ownTextOf(all[t]) === ownText) matches++;
        }
        // Only when it identifies exactly one element, or the step would be ambiguous and
        // Playwright would refuse to act on it.
        if (matches === 1) return tagName + ':text-is("' + ownText.replace(/"/g, '\\\\"') + '")';
      }

      // Structural fallback: nth-of-type path, stopping at the closest unique ancestor id —
      // or at the top of the shadow root, whose host the caller has already addressed.
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
        // The anchor matters as much as the leaf: a path rooted at #cdk-overlay-0 is exactly
        // as unreplayable as a leaf selector of #cdk-overlay-0, and that is where most of
        // them came from — an overlay is where a menu or a dialog lives.
        var anchor = usableId(node, roots);
        if (anchor) {
          parts.unshift(anchor);
          break;
        }
        var part = node.tagName.toLowerCase();
        var parent = node.parentElement;
        // A root's top-level children are siblings too, though they have no parent element.
        var siblings = parent || (isShadowRoot(node.parentNode) ? node.parentNode : null);
        if (siblings) {
          var sameTag = Array.prototype.filter.call(siblings.children, function (c) {
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

  /**
   * The text an element owns, rather than everything under it.
   *
   * Only its direct text nodes, which is how Playwright's :text-is() decides. innerText adds
   * up the descendants, so by that measure a menu label and every wrapper above it all "have"
   * the same text — the uniqueness check then called a selector ambiguous that the engine
   * resolves to exactly one element, and the recorder fell back to counting divs from body.
   * Measured on the real page: span:text-is(label) matched 1, a:text-is(label) matched 0,
   * while innerText said two spans and one anchor carried it.
   */
  function ownTextOf(node) {
    var out = '';
    for (var c = 0; c < node.childNodes.length; c++) {
      if (node.childNodes[c].nodeType === 3) out += node.childNodes[c].nodeValue;
    }
    return out.replace(/\\s+/g, ' ').trim();
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

  /* ------------------------------------------------------------------------ frames */

  // The parent frame's recorder builds the selector of the iframe element, because only that
  // document can see it — including when the iframe itself sits in an open shadow root.
  try {
    Object.defineProperty(window, '__wfmRecorderSelectorFor', { value: generateSelector });
  } catch (e) { /* already defined by an earlier copy: the guard at the top makes this rare */ }

  var IS_TOP = (function () { try { return window === window.top; } catch (e) { return false; } })();

  /**
   * The frame path replay enters before resolving the selector: one selector per iframe,
   * outermost first, joined with ' >> ' exactly as element detection writes frameSelector.
   * A frame whose element its parent cannot address (cross-origin) has no such path.
   */
  function frameContext() {
    if (IS_TOP) return {};
    var chain = [];
    try {
      var w = window;
      while (w !== w.top) {
        var frameEl = w.frameElement; // null when the parent is another origin
        var selectorFor = frameEl ? w.parent.__wfmRecorderSelectorFor : null;
        var selector = typeof selectorFor === 'function' ? selectorFor(frameEl) : null;
        if (!selector) return { unsupported: 'unaddressable-frame' };
        chain.unshift(selector);
        w = w.parent;
      }
    } catch (e) {
      return { unsupported: 'unaddressable-frame' };
    }
    return { frameSelector: chain.join(' >> ') };
  }

  /* --------------------------------------------------------------- shadow listeners */

  // change does not cross a shadow boundary (it is not composed), so a listener on document
  // never hears it from inside a component: every root gets its own, exactly once.
  function hookRoot(root, closed) {
    if (!root || hookedRoots.has(root)) return;
    hookedRoots.add(root);
    root.addEventListener('change', closed ? onClosedRootChange : onChange, true);
  }

  // Every root the page creates, open or closed, from the moment it exists. The init script
  // runs before any page script, so nothing is attached before this is in place.
  try {
    var nativeAttachShadow = Element.prototype.attachShadow;
    if (typeof nativeAttachShadow === 'function') {
      Element.prototype.attachShadow = function (init) {
        var root = nativeAttachShadow.apply(this, arguments);
        var closed = !!(init && init.mode === 'closed');
        if (closed) closedHosts.add(this);
        hookRoot(root, closed);
        return root;
      };
    }
  } catch (e) { /* the path hook below still covers open roots */ }

  // Roots attachShadow never saw — declarative shadow DOM is built by the parser — are hooked
  // the first time an event passes through them. Focus, pointer and key events are composed
  // and always precede the change they lead to, so the listener is there in time.
  function hookPath(event) {
    var path = event.composedPath ? event.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (isShadowRoot(path[i])) hookRoot(path[i], false);
    }
  }
  ['focusin', 'pointerdown', 'mousedown', 'click', 'keydown'].forEach(function (type) {
    window.addEventListener(type, hookPath, true);
  });

  /** Marks what replay could not resolve, so it is shown rather than silently missing. */
  function annotate(action, el) {
    if (el && closedHosts.has(el)) action.unsupported = 'closed-shadow-root';
    return action;
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
    // Counted as the engine counts, across open roots. A selector with a shadow path or a
    // :text-is() cannot be evaluated natively; it was built to match one element.
    var matchCount = 1;
    try { matchCount = deepQueryAll(searchRoots(document), selector).length || 1; } catch (e) { /* ignore */ }

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
    var el = deepTarget(event);
    if (isRecorderUi(el)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    clearHighlight();
    openAssertPanel(el, event.clientX + 8, event.clientY + 8);
  }, true);

  document.addEventListener('mouseover', function (event) {
    if (!assertModeOn()) return;
    highlight(deepTarget(event));
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
    var el = deepTarget(event);
    if (el && !isRecorderUi(el)) lastHovered = el;
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
          if (composedContains(node, lastHovered)) continue;
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
      // A step cannot hover something that has since left the document. Without this, a menu
      // entry that was clicked and then removed still counted as the thing that revealed
      // whatever rendered next.
      if (!p.host.isConnected) continue;
      if (composedContains(p.root, clicked) && !composedContains(p.host, clicked)) return p.host;
    }
    return null;
  }

  var lastHoverSelectorSent = null;

  document.addEventListener('click', function (event) {
    try {
      var el = deepTarget(event);
      if (!el || isRecorderUi(el) || isIgnored(el)) return;

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
      send(annotate(action, el));
    } catch (e) { /* never break the page under test */ }
  }, true);

  // On document and on every open root (see hookRoot). Each change event is recorded once,
  // whichever of them hears it first: a component may re-dispatch it as composed.
  function onChange(event) {
    try {
      if (seenChanges.has(event)) return;
      seenChanges.add(event);
      var el = deepTarget(event);
      if (!el) return;
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
        inputType: tag === 'input' ? String(el.type || 'text').toLowerCase() : undefined,
        timestamp: Date.now(),
        url: window.location.href
      };
      var details = getElementDetails(el);
      for (var k in details) action[k] = details[k];
      send(action);
    } catch (e) { /* never break the page under test */ }
  }
  document.addEventListener('change', onChange, true);

  // A value typed inside a closed root: the engine cannot reach the field, so the step is
  // reported against its host as unsupported. The value is never read — it may be a secret.
  function onClosedRootChange(event) {
    try {
      if (seenChanges.has(event)) return;
      seenChanges.add(event);
      var root = event.currentTarget;
      var host = root && root.host;
      var inner = event.composedPath ? event.composedPath()[0] : null;
      if (!host || isRecorderUi(host) || isIgnored(host)) return;
      send({
        type: inner && inner.tagName && inner.tagName.toLowerCase() === 'select' ? 'select' : 'input',
        selector: generateSelector(host),
        value: null,
        unsupported: 'closed-shadow-root',
        timestamp: Date.now(),
        url: window.location.href,
        targetTag: host.tagName.toLowerCase()
      });
    } catch (e) { /* never break the page under test */ }
  }

  document.addEventListener('keydown', function (event) {
    try {
      if (event.key !== 'Enter') return;
      var el = deepTarget(event);
      if (!el || isRecorderUi(el) || isIgnored(el)) return;
      send(annotate({
        type: 'keypress',
        key: 'Enter',
        selector: generateSelector(el),
        timestamp: Date.now(),
        url: window.location.href
      }, el));
    } catch (e) { /* ignore */ }
  }, true);

  /* ------------------------------------------------------------------- navigations */

  function reportNavigation() {
    // A route change replaces most of the document, and whatever the pointer happened to be
    // over at that moment would otherwise be credited with having revealed all of it — so
    // the next click anywhere on the new screen produced a hover step for a menu entry that
    // had just been clicked and was already gone.
    pendingHovers = [];
    // The blank document a new tab starts in is not a page of the test: Chromium reports it as
    // about:blank and Firefox with an empty URL, and the engine refuses a navigate step to it.
    if (!/^https?:/i.test(window.location.href)) return;
    send({ type: 'navigate', url: window.location.href, value: window.location.href, timestamp: Date.now() });
  }

  // Only the top document navigates the test. The init script also runs in every iframe, and
  // an iframe's own load reported as a navigation would replay as a top-level navigation to
  // the iframe's URL.
  if (IS_TOP) {
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
  }

  /* -------------------------------------------------------------------- bootstrap */

  // One toolbar, on the page the user sees, not one per iframe.
  if (IS_TOP && document.body) {
    renderToolbar();
    if (assertModeOn()) document.documentElement.style.cursor = 'crosshair';
  } else if (IS_TOP) {
    document.addEventListener('DOMContentLoaded', function () {
      renderToolbar();
      if (assertModeOn()) document.documentElement.style.cursor = 'crosshair';
    }, { once: true });
  }
})();
`;
