import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A site built out of web components, for the recorder (P12, C11).
 *
 * Shared by server/authoring/recorder-script.test.ts (Chromium, the real engine) and
 * e2e/recorder-shadow.spec.ts (Chromium, Firefox and WebKit), so both prove the same thing on
 * the same markup:
 *  - a plain light-DOM input, the control: what worked before must still work;
 *  - an open shadow root whose field shares its name with the light one, so a selector that is
 *    unique by document.querySelectorAll is ambiguous to the engine, which pierces open roots;
 *  - a password and an Enter-to-submit inside a root (masking, Enter/value reorder);
 *  - two roots nested, holding a select, a checkbox and a button known only by its text;
 *  - a component created after load, and one removed and put back (no listener twice);
 *  - a declarative shadow root, which the parser builds without calling attachShadow;
 *  - a closed root, which the engine cannot enter: it must be reported, not guessed at;
 *  - /frames: an iframe that sits inside a shadow root and holds a component of its own, so a
 *    frame path and two shadow paths meet in one step.
 *
 * Every field writes its final value into #echo (light DOM) of its own document, which is how a
 * replay is checked: same values, on the same targets, give the same text.
 */

const COMPONENTS = `
  window.__state = {};
  function render() {
    var echo = document.getElementById('echo');
    if (!echo) return;
    echo.textContent = Object.keys(window.__state).sort().map(function (k) {
      return k + '=' + window.__state[k];
    }).join(';');
  }
  function track(root) {
    // Each document or root answers for its own elements only, so nothing counts twice.
    function own(ev) {
      var el = ev.composedPath()[0];
      return el && el.getRootNode && el.getRootNode() === root ? el : null;
    }
    function record(ev) {
      var el = own(ev);
      if (!el || !el.name) return;
      var v = el.type === 'checkbox' ? (el.checked ? 'on' : 'off')
        : el.type === 'password' ? 'len' + el.value.length : el.value;
      window.__state[el.getAttribute('data-key') || el.name] = v;
      render();
    }
    root.addEventListener('input', record);
    root.addEventListener('change', record);
    root.addEventListener('keydown', function (ev) {
      var el = own(ev);
      if (ev.key !== 'Enter' || !el) return;
      window.__state.submitted = el.value;
      render();
    });
    root.addEventListener('click', function (ev) {
      var el = own(ev);
      if (!el || el.tagName !== 'BUTTON' || !el.hasAttribute('data-count')) return;
      var key = el.getAttribute('data-count');
      window.__state[key] = (Number(window.__state[key]) || 0) + 1;
      render();
    });
  }
  function component(tag, html, mode) {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        // Put back after a removal, it keeps the root it already has: one root, ever.
        if (this.__root) return;
        this.__root = this.attachShadow({ mode: mode || 'open' });
        this.__root.innerHTML = html;
        track(this.__root);
      }
    });
  }
  component('x-login',
    '<label>User <input name="q" data-key="user"></label>' +
    '<label>Password <input id="pass" name="pass" type="password"></label>' +
    '<label>Search <input name="search"></label>');
  component('x-outer', '<section><h2>Outer</h2><x-inner></x-inner></section>');
  component('x-inner',
    '<select name="color"><option>red</option><option>green</option><option>blue</option></select>' +
    '<label><input type="checkbox" name="agree"> I agree</label>' +
    '<button type="button" data-count="saved">Save</button>');
  component('x-late', '<input name="late">');
  component('x-closed', '<input name="hidden-field"><button type="button">Inside closed</button>', 'closed');
  component('x-field', '<input name="city">');
  component('x-frame-shell', '<p>Embedded</p><iframe name="inner" src="/frames/inner" width="420" height="120"></iframe>');
  document.addEventListener('DOMContentLoaded', function () {
    track(document);
    var decl = document.querySelector('x-decl');
    if (decl && decl.shadowRoot) track(decl.shadowRoot);
  });
`;

export const SHADOW_PAGE = `<!doctype html>
<html><head><title>Shadow fixture</title><script>${COMPONENTS}</script></head>
<body>
  <h1 id="title">Components</h1>
  <!-- The control. Same name as the field inside x-login, on purpose. -->
  <label>Plain <input name="q" data-key="plain"></label>
  <x-login></x-login>
  <x-outer></x-outer>
  <x-decl><template shadowrootmode="open"><input name="decl"></template></x-decl>
  <button id="add-late" type="button">Add widget</button>
  <button id="cycle-late" type="button">Remove and restore widget</button>
  <div id="late-slot"></div>
  <x-closed></x-closed>
  <p id="echo"></p>
  <script>
    document.getElementById('add-late').addEventListener('click', function () {
      if (!document.querySelector('x-late')) {
        document.getElementById('late-slot').appendChild(document.createElement('x-late'));
      }
    });
    document.getElementById('cycle-late').addEventListener('click', function () {
      var widget = document.querySelector('x-late');
      if (!widget) return;
      widget.remove();
      document.getElementById('late-slot').appendChild(widget);
    });
  </script>
</body></html>`;

export const FRAMES_PAGE = `<!doctype html>
<html><head><title>Frames fixture</title><script>${COMPONENTS}</script></head>
<body>
  <h1 id="title">Host</h1>
  <x-frame-shell></x-frame-shell>
</body></html>`;

export const FRAME_INNER_PAGE = `<!doctype html>
<html><head><title>Inner</title><script>${COMPONENTS}</script></head>
<body>
  <h2 id="inner-title">Inside the frame</h2>
  <x-field></x-field>
  <p id="echo"></p>
</body></html>`;

export interface ShadowFixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/** On a free port by default; `npm run fixture:shadow` pins 5090 for the manual collaudo cases. */
export async function startShadowFixture(port = 0): Promise<ShadowFixtureServer> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const body =
      path === '/frames/inner' ? FRAME_INNER_PAGE : path === '/frames' ? FRAMES_PAGE : SHADOW_PAGE;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
