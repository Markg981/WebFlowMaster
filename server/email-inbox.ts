/**
 * Reading the mail an application under test sends: the code of a sign-up, the link of a
 * password reset. Without it those flows could be tested only up to "check your inbox".
 *
 * The inbox is a Mailpit (https://mailpit.axllent.org): a mail catcher that accepts whatever
 * the application sends to its SMTP port, for any address, and shows it through an HTTP API.
 * Test environments point their SMTP at one as a matter of course, so the application needs
 * nothing new, and every made-up address such as {{$randomEmail}} has a mailbox.
 *
 * Which Mailpit is the environment's business, like the rest of its settings: the variables
 * `mailpit.url`, `mailpit.username` and `mailpit.password` (kept encrypted with the
 * environment's other secrets), falling back to MAILPIT_URL, MAILPIT_USERNAME and
 * MAILPIT_PASSWORD on the server, which is how the docker-compose stack wires its own.
 *
 * Pure except for the HTTP calls, which go through a `get` the caller supplies: the step
 * executor passes the browser context's request API, so a run on a local agent reads the
 * Mailpit of the agent's network, as it reaches the application of that network.
 */

export interface InboxConfig {
  url: string;
  authorization?: string;
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  /** When Mailpit received it. */
  received: Date;
  text: string;
  html: string;
}

export interface EmailFound {
  message: InboxMessage;
  otp: string | null;
  link: string | null;
}

/** How long a wait for an email lasts: SMTP delivery and a queue in the application are slow. */
export const EMAIL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
/**
 * Mailpit's clock and the runner's are different machines. An email is accepted when it
 * arrived after the test started, less this much, so a skewed clock does not throw away the
 * email the test is waiting for.
 */
export const CLOCK_SLACK_MS = 30_000;

/** The inbox the variables name, the server's own, or null when there is none. */
export function inboxConfig(vars: Record<string, string>, env: NodeJS.ProcessEnv = process.env): InboxConfig | null {
  const fromVars = vars['mailpit.url']?.trim();
  const url = (fromVars || env.MAILPIT_URL || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  const username = fromVars ? vars['mailpit.username'] : env.MAILPIT_USERNAME;
  const password = fromVars ? vars['mailpit.password'] : env.MAILPIT_PASSWORD;
  return {
    url,
    ...(username ? { authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` } : {}),
  };
}

/**
 * What a step asks for: `address`, `address|subject`, or `address|subject|pattern`, where the
 * subject is a text the subject contains and the pattern a regular expression whose first
 * group (or whole match) is the code to read.
 */
export interface EmailQuery {
  address: string;
  subject: string;
  pattern: RegExp | null;
}

export function parseEmailQuery(value: string): EmailQuery | { error: string } {
  const [address = '', subject = '', ...rest] = value.split('|');
  const to = address.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(to)) {
    return { error: `"${to}" is not an email address. The value is address, address|subject, or address|subject|pattern.` };
  }
  const source = rest.join('|').trim();
  let pattern: RegExp | null = null;
  if (source) {
    try {
      pattern = new RegExp(source, 'i');
    } catch (error: any) {
      return { error: `The pattern "${source}" is not a valid regular expression: ${error?.message ?? error}.` };
    }
  }
  return { address: to, subject: subject.trim(), pattern };
}

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** The text a person reads in an HTML email, for one that has no text part. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Words that sit next to a one-time code, in the languages the product speaks. */
const CODE_WORDS = /(code|codice|otp|pin|passcode|one[- ]time|verification|verifica|conferma|confirm|token|bestätigung|Bestätigungscode|vérification)/i;

/**
 * The one-time code in an email.
 *
 * The first 4–8 digit number after a word such as "code" or "OTP", because an email holds
 * other numbers — a year in the footer, a street address, an order number — and the code is
 * the one the text introduces. Failing that, the only such number when there is exactly one.
 * A pattern, when the step gives one, replaces both guesses.
 */
export function findOtp(text: string, pattern: RegExp | null = null): string | null {
  if (pattern) {
    const match = text.match(pattern);
    if (!match) return null;
    return (match[1] ?? match[0]).trim();
  }
  // Not the numbers inside links: a port, an id in a path. Keycloak's reset email has only one
  // number, the port of its own address, and it was taken for the code.
  const plain = text.replace(/https?:\/\/[^\s<>"')\]]+/g, ' ');
  const numbers = [...plain.matchAll(/(?<![\w.,:/-])(\d{4,8})(?![\w.,/-]?\d)/g)];
  for (const number of numbers) {
    const before = plain.slice(Math.max(0, number.index! - 80), number.index);
    if (CODE_WORDS.test(before)) return number[1];
  }
  const distinct = [...new Set(numbers.map((n) => n[1]))];
  return distinct.length === 1 ? distinct[0] : null;
}

/** Links that are about the email rather than the thing it asks the reader to do. */
const INCIDENTAL_LINK = /unsubscribe|optout|opt-out|privacy|preferences|mailto:|\.(png|jpe?g|gif|svg|css)(\?|$)/i;

/**
 * The link the email asks the reader to follow: the first http(s) link in the HTML that is not
 * an unsubscribe, a logo or a stylesheet, else the first in the text.
 */
export function findLink(message: Pick<InboxMessage, 'html' | 'text'>): string | null {
  const hrefs = [...message.html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)].map((m) => decodeEntities(m[2]));
  const inText = [...message.text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0]);
  const candidates = [...hrefs, ...inText].filter((link) => /^https?:\/\//i.test(link));
  return candidates.find((link) => !INCIDENTAL_LINK.test(link)) ?? candidates[0] ?? null;
}

/** GET a JSON document from the inbox: the caller decides the transport. */
export type InboxGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: () => Promise<any> }>;

interface Summary {
  ID: string;
  Created: string;
  Subject: string;
  To?: { Address: string }[] | null;
  Cc?: { Address: string }[] | null;
  Bcc?: { Address: string }[] | null;
}

async function getJson(get: InboxGet, config: InboxConfig, path: string): Promise<any> {
  let response: Awaited<ReturnType<InboxGet>>;
  try {
    response = await get(`${config.url}${path}`, config.authorization ? { Authorization: config.authorization } : {});
  } catch (error: any) {
    throw new Error(`The test inbox at ${config.url} could not be reached: ${error?.message ?? error}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`The test inbox at ${config.url} refused the credentials (HTTP ${response.status}): check mailpit.username and mailpit.password.`);
  }
  if (response.status >= 400) {
    throw new Error(`The test inbox at ${config.url} answered HTTP ${response.status}. Is it a Mailpit?`);
  }
  return response.json();
}

/**
 * Waits for the newest email to the address, received since `since`, whose subject contains
 * the one asked for; then reads it whole.
 */
export async function waitForEmail(
  get: InboxGet,
  config: InboxConfig,
  query: EmailQuery,
  since: number,
  timeoutMs = EMAIL_TIMEOUT_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EmailFound | null> {
  const deadline = Date.now() + timeoutMs;
  const search = `/api/v1/search?limit=50&query=${encodeURIComponent(`to:"${query.address}"`)}`;
  const address = query.address.toLowerCase();
  const subject = query.subject.toLowerCase();
  for (;;) {
    const page = await getJson(get, config, search);
    const found = ((page?.messages ?? []) as Summary[])
      // Mailpit's search matches the address as words; the recipient must be this one exactly.
      .filter((m) => [...(m.To ?? []), ...(m.Cc ?? []), ...(m.Bcc ?? [])].some((to) => to.Address?.toLowerCase() === address))
      .filter((m) => !subject || (m.Subject ?? '').toLowerCase().includes(subject))
      .filter((m) => Date.parse(m.Created) >= since - CLOCK_SLACK_MS)
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
    if (found) {
      const full = await getJson(get, config, `/api/v1/message/${encodeURIComponent(found.ID)}`);
      const html = String(full?.HTML ?? '');
      const message: InboxMessage = {
        id: found.ID,
        from: full?.From?.Address ?? '',
        to: ((full?.To ?? []) as { Address: string }[]).map((t) => t.Address),
        subject: String(full?.Subject ?? found.Subject ?? ''),
        received: new Date(found.Created),
        html,
        text: String(full?.Text ?? '').trim() || htmlToText(html),
      };
      return { message, otp: findOtp(`${message.subject}\n${message.text}`, query.pattern), link: findLink(message) };
    }
    if (Date.now() >= deadline) return null;
    await sleep(POLL_INTERVAL_MS);
  }
}
