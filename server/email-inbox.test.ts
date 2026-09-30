import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { chromium, type Browser, type Page } from 'playwright';
import { findLink, findOtp, htmlToText, inboxConfig, parseEmailQuery, waitForEmail, type InboxGet } from './email-inbox';
import { executeStep } from './step-executor';

/**
 * Reading the email an application under test sends, from the environment's Mailpit: the
 * code of a sign-up and the link of a password reset, which a test could not reach before.
 */

describe('what the step asks for', () => {
  it('reads address, subject and pattern', () => {
    expect(parseEmailQuery('a@b.test')).toEqual({ address: 'a@b.test', subject: '', pattern: null });
    const full = parseEmailQuery(' a@b.test | Reset your password | code: (\\w{6}) ');
    expect(full).toMatchObject({ address: 'a@b.test', subject: 'Reset your password' });
    expect('pattern' in full && full.pattern?.source).toBe('code: (\\w{6})');
    expect(parseEmailQuery('not an address')).toMatchObject({ error: /not an email address/ });
    expect(parseEmailQuery('a@b.test|x|(unclosed')).toMatchObject({ error: /not a valid regular expression/ });
  });

  it('finds the inbox in the environment first, then on the server', () => {
    expect(inboxConfig({}, {})).toBeNull();
    expect(inboxConfig({}, { MAILPIT_URL: 'http://mailpit:8025/' })).toEqual({ url: 'http://mailpit:8025' });
    const fromEnvironment = inboxConfig(
      { 'mailpit.url': 'https://mail.staging.test', 'mailpit.username': 'qa', 'mailpit.password': 'pw' },
      { MAILPIT_URL: 'http://mailpit:8025', MAILPIT_USERNAME: 'server' },
    );
    expect(fromEnvironment).toEqual({ url: 'https://mail.staging.test', authorization: `Basic ${Buffer.from('qa:pw').toString('base64')}` });
  });
});

describe('what the step reads out of an email', () => {
  it('takes the code the text introduces, not the year in the footer', () => {
    expect(findOtp('Welcome!\nYour verification code is 482913.\n© 2026 Example Inc, 1600 Main St')).toBe('482913');
    expect(findOtp('Il tuo codice: *0042*')).toBe('0042');
    expect(findOtp('Use 771204 to sign in')).toBe('771204');
    expect(findOtp('Order 12345 shipped on 2026-09-30, total 99.50, ref 4711')).toBeNull();
    expect(findOtp('Phone +39 0212345678; card ending 1234 5678')).toBeNull();
    // Keycloak's password reset, as it arrives: the only number is the port in the link.
    expect(findOtp("Reset password\nSomeone just requested to change your Acme account's credentials.\n\nhttp://127.0.0.1:18080/realms/acme/login-actions/action-token?key=eyJ&tab_id=L1\n\nThis link will expire within 5 minutes.")).toBeNull();
    expect(findOtp('Open https://app.test:8443/verify/123456 or enter code 654321')).toBe('654321');
  });

  it('takes a pattern when the code is not a number', () => {
    expect(findOtp('Your code is AB-12-CD', /code is ([A-Z0-9-]+)/i)).toBe('AB-12-CD');
    expect(findOtp('Nothing here', /code is (\w+)/)).toBeNull();
  });

  it('takes the link to follow, not the logo or the unsubscribe', () => {
    const html = `<img src="https://cdn.app.test/logo.png">
      <a href="https://app.test/unsubscribe?u=1">Unsubscribe</a>
      <a href="https://app.test/reset?token=a1&amp;u=7">Reset password</a>`;
    expect(findLink({ html, text: '' })).toBe('https://app.test/reset?token=a1&u=7');
    expect(findLink({ html: '', text: 'Open https://app.test/verify/abc). Thanks' })).toBe('https://app.test/verify/abc');
    expect(findLink({ html: '', text: 'no links' })).toBeNull();
  });

  it('reads an HTML-only email as text', () => {
    expect(htmlToText('<style>p{}</style><p>Code&nbsp;<b>123456</b></p><p>Bye &amp; thanks</p>')).toBe('Code 123456\nBye & thanks');
  });
});

// ─── A Mailpit and an application ────────────────────────────────────────────

interface Mail {
  ID: string;
  Created: string;
  From: { Address: string };
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

/**
 * Mailpit's API as the real one answers it (checked against axllent/mailpit), plus the sign-up
 * page of an application that mails a code and a link a moment after the form is sent.
 */
function fakeWorld() {
  const mails: Mail[] = [];
  let next = 1;
  let requireAuth = false;
  const deliver = (to: string, subject: string, html: string, text = '', at = new Date()) =>
    mails.push({ ID: `m${next++}`, Created: at.toISOString(), From: { Address: 'noreply@app.test' }, To: [{ Address: to }], Subject: subject, Text: text, HTML: html });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      if (requireAuth && req.headers.authorization !== `Basic ${Buffer.from('qa:pw').toString('base64')}`) return res.writeHead(401).end();
      if (url.pathname === '/api/v1/search') {
        const term = /to:"([^"]+)"/.exec(url.searchParams.get('query') ?? '')?.[1]?.toLowerCase() ?? '';
        // Word matching, like Mailpit's: a longer address that contains this one matches too.
        const messages = mails.filter((m) => m.To.some((t) => t.Address.toLowerCase().includes(term))).reverse();
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messages, messages_count: messages.length }));
      }
      const mail = mails.find((m) => m.ID === url.pathname.split('/').pop());
      return mail ? res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(mail)) : res.writeHead(404).end();
    }
    if (url.pathname === '/signup' && req.method === 'POST') {
      const email = url.searchParams.get('email')!;
      // The application's mail goes out after the answer, as a queued job would send it.
      setTimeout(() => deliver(email, 'Confirm your account', `<p>Your verification code is <b>905172</b>.</p><a href="${base}/confirm?u=${encodeURIComponent(email)}">Confirm</a><p>© 2026</p>`), 1500);
      return res.writeHead(204).end();
    }
    if (url.pathname === '/confirm') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<h1 id="done">Confirmed ${url.searchParams.get('u')}</h1><input id="code">`);
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      `<input id="email"><button id="go" onclick="fetch('/signup?email='+encodeURIComponent(document.getElementById('email').value),{method:'POST'})">Sign up</button>`,
    );
  });
  let base = '';
  return {
    server,
    deliver,
    mails,
    setBase: (value: string) => (base = value),
    requireAuth: (value: boolean) => (requireAuth = value),
  };
}

const step = (id: string, value = '', selector?: string) => ({
  action: { id, name: id },
  value,
  ...(selector ? { targetElement: { selector } } : {}),
});

describe('the waitForEmail step', () => {
  let world: ReturnType<typeof fakeWorld>;
  let base: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    world = fakeWorld();
    await new Promise<void>((resolve) => world.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(world.server.address() as AddressInfo).port}`;
    world.setBase(base);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => world.server.close(() => resolve()));
  });

  it('signs up with a made-up address, reads the code and follows the link', async () => {
    const vars: Record<string, string> = { 'mailpit.url': base };
    const ctx = { page, vars, startedAt: Date.now() };
    for (const s of [
      step('setVariable', 'email={{$randomEmail}}'),
      step('navigate', base),
      step('input', '{{email}}', '#email'),
      step('click', '', '#go'),
    ]) {
      expect((await executeStep(ctx, s)).status).toBe('passed');
    }

    const waited = await executeStep(ctx, step('waitForEmail', '{{email}}|confirm your'));
    expect(waited).toMatchObject({ status: 'passed', detail: expect.stringContaining('{{email.otp}} = "905172"') });
    expect(vars['email.otp']).toBe('905172');
    expect(vars['email.subject']).toBe('Confirm your account');
    expect(vars['email.from']).toBe('noreply@app.test');
    expect(vars['email.text']).toContain('Your verification code is 905172');

    expect((await executeStep(ctx, step('navigate', '{{email.link}}'))).status).toBe('passed');
    expect((await executeStep(ctx, step('input', '{{email.otp}}', '#code'))).status).toBe('passed');
    expect(await page.textContent('#done')).toBe(`Confirmed ${vars.email}`);
  }, 60_000);

  it("takes the newest email to exactly that address, and not one from before the test", async () => {
    const at = Date.now();
    world.deliver('old@qa.test', 'Reset', '<p>code 111111</p>', '', new Date(at - 10 * 60_000));
    world.deliver('xold@qa.test', 'Reset', '<p>code 222222</p>');
    world.deliver('old@qa.test', 'Reset', '<p>code 333333</p>');
    world.deliver('old@qa.test', 'Reset', '<p>code 444444</p>');
    const vars: Record<string, string> = { 'mailpit.url': base, 'mailpit.timeout': '2' };
    await executeStep({ page, vars, startedAt: at }, step('waitForEmail', 'OLD@qa.test'));
    expect(vars['email.otp']).toBe('444444');

    // Only the ten-minute-old one for this address: the test has to wait, and gives up.
    world.deliver('stale@qa.test', 'Reset', '<p>code 555555</p>', '', new Date(at - 10 * 60_000));
    const stale = await executeStep({ page, vars, startedAt: at }, step('waitForEmail', 'stale@qa.test'));
    expect(stale.status).toBe('failed');
    expect(stale.error).toMatch(/No email to stale@qa\.test arrived within 2s at http:\/\/127\.0\.0\.1:\d+\. Check that the application's SMTP server is that Mailpit/);
    // What the previous email set is gone, so a later {{email.otp}} is reported missing.
    expect(vars['email.otp']).toBeUndefined();
  }, 60_000);

  it('reads a code with a pattern, and fails when the pattern finds nothing', async () => {
    world.deliver('pattern@qa.test', 'Your login code', '<p>Code: AB7-X2Q</p>');
    const vars: Record<string, string> = { 'mailpit.url': base, 'mailpit.timeout': '2' };
    const ok = await executeStep({ page, vars, startedAt: Date.now() }, step('waitForEmail', 'pattern@qa.test|login code|Code: ([A-Z0-9-]+)'));
    expect(ok.status).toBe('passed');
    expect(vars['email.otp']).toBe('AB7-X2Q');
    const none = await executeStep({ page, vars, startedAt: Date.now() }, step('waitForEmail', 'pattern@qa.test||PIN (\\d+)'));
    expect(none).toMatchObject({ status: 'failed', error: expect.stringMatching(/pattern \/PIN \(\\d\+\)\/ matched nothing/) });
  }, 60_000);

  it('says what is wrong with the inbox rather than timing out', async () => {
    const nothing = await executeStep({ page, vars: {}, startedAt: Date.now() }, step('waitForEmail', 'a@qa.test'));
    expect(nothing.error).toMatch(/No test inbox is configured/);

    world.requireAuth(true);
    try {
      const refused = await executeStep({ page, vars: { 'mailpit.url': base } }, step('waitForEmail', 'a@qa.test'));
      expect(refused.error).toMatch(/refused the credentials \(HTTP 401\)/);
      world.deliver('auth@qa.test', 'Hi', '<p>code 909090</p>');
      const vars = { 'mailpit.url': base, 'mailpit.username': 'qa', 'mailpit.password': 'pw' } as Record<string, string>;
      expect((await executeStep({ page, vars, startedAt: Date.now() }, step('waitForEmail', 'auth@qa.test'))).status).toBe('passed');
    } finally {
      world.requireAuth(false);
    }

    const unreachable = await executeStep({ page, vars: { 'mailpit.url': 'http://127.0.0.1:1' } }, step('waitForEmail', 'a@qa.test'));
    expect(unreachable.error).toMatch(/could not be reached/);
    const unresolved = await executeStep({ page, vars: { 'mailpit.url': base } }, step('waitForEmail', '{{email}}'));
    expect(unresolved.error).toMatch(/Unresolved variable\(s\) email/);
  }, 60_000);
});

// ─── A real Mailpit, when one is at hand ─────────────────────────────────────

/** Just enough SMTP to send one message, as an application would. */
function sendMail(port: number, to: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const lines = ['EHLO wfm', 'MAIL FROM:<noreply@app.test>', `RCPT TO:<${to}>`, 'DATA', `${body}\r\n.`, 'QUIT'];
    let i = 0;
    socket.on('data', (chunk) => {
      if (/^[45]\d\d /m.test(chunk.toString())) reject(new Error(chunk.toString()));
      else if (i < lines.length) socket.write(`${lines[i++]}\r\n`);
    });
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}

// MAILPIT_TEST_URL=http://127.0.0.1:8025 MAILPIT_TEST_SMTP_PORT=1025, e.g. with
// `docker run -p 8025:8025 -p 1025:1025 axllent/mailpit`.
describe.runIf(process.env.MAILPIT_TEST_URL)('against a real Mailpit', () => {
  it('reads what arrived over SMTP', async () => {
    const to = `wfm.${Date.now()}@example.com`;
    const since = Date.now();
    await sendMail(Number(process.env.MAILPIT_TEST_SMTP_PORT ?? 1025), to, [
      'From: App <noreply@app.test>',
      `To: ${to}`,
      'Subject: Reset your password',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Your reset code is <b>318402</b>.</p><a href="https://app.test/reset?t=x&amp;u=2">Reset</a><p>&copy; 2026</p>',
    ].join('\r\n'));
    const get: InboxGet = async (url, headers) => {
      const response = await fetch(url, { headers });
      return { status: response.status, json: () => response.json() };
    };
    const found = await waitForEmail(get, { url: process.env.MAILPIT_TEST_URL! }, { address: to.toUpperCase(), subject: 'reset', pattern: null }, since, 10_000);
    expect(found).toMatchObject({ otp: '318402', link: 'https://app.test/reset?t=x&u=2', message: { subject: 'Reset your password', from: 'noreply@app.test' } });
  }, 30_000);
});
