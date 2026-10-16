import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { LaunchOptions } from 'playwright';
import { browserEgressOptions, egressProxy } from './egress-proxy';
import {
  EGRESS_POLICY_HEADER,
  denialForHostname,
  egressDenialCause,
  vettedLookup,
  type EgressDeniedError,
} from './egress-policy';

/**
 * The proxy the runner's own browsers are launched behind, so that every connection they open
 * is decided by the egress policy, whoever opens it.
 *
 * `context.route` sees the requests of pages, frames and service workers, and
 * `context.routeWebSocket` the WebSockets of pages; neither sees a WebSocket opened by a
 * dedicated worker, and neither sees the address the browser's own resolver picks. A proxy
 * sees both: every request and every tunnel (CONNECT, which is also how a browser carries a
 * WebSocket through a proxy) is made from here, with the same checkHostname and vettedLookup
 * the server's other transports use. So a name that resolves to a denied address is refused at
 * connect time, which closes the rebinding window the route check leaves open.
 *
 * The hardened deployment sets WFM_EGRESS_PROXY: there the browser goes through that proxy as
 * before, and its firewall is the authority (docs/en/admin/saas-network.md). A grid's or an
 * agent's browser is on its owner's network and is not launched here.
 */

const BAD_GATEWAY = 502;

/** host:port of a CONNECT, with the brackets of an IPv6 literal kept for the URL parser. */
function splitAuthority(authority: string): { hostname: string; port: number } | undefined {
  try {
    const url = new URL(`http://${authority}`);
    return { hostname: url.hostname, port: Number(url.port) || 443 };
  } catch {
    return undefined;
  }
}

function refuseSocket(socket: Duplex, status: number, denial?: EgressDeniedError): void {
  const body = denial?.message ?? 'The runner could not reach this address.';
  const head = [
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}`,
    'content-type: text/plain; charset=utf-8',
    `content-length: ${Buffer.byteLength(body)}`,
    ...(denial ? [`${EGRESS_POLICY_HEADER}: ${denial.rule}`] : []),
    'connection: close',
    '',
    '',
  ].join('\r\n');
  socket.end(head + body);
}

/** Opens the upstream connection the policy allows, or answers the client with the refusal. */
function tunnel(
  hostname: string,
  port: number,
  client: Duplex,
  onOpen: (upstream: net.Socket) => void,
): void {
  // A literal address never goes through `lookup`: decide it from the name first.
  const immediate = denialForHostname(hostname);
  if (immediate) return refuseSocket(client, 403, immediate);
  const upstream = net.connect({
    host: hostname.replace(/^\[|\]$/g, ''),
    port,
    lookup: vettedLookup(),
  });
  upstream.once('connect', () => onOpen(upstream));
  upstream.once('error', (error) => {
    const denial = egressDenialCause(error);
    if (!client.destroyed) refuseSocket(client, denial ? 403 : BAD_GATEWAY, denial);
  });
  client.once('error', () => upstream.destroy());
  client.once('close', () => upstream.destroy());
}

function onConnect(req: http.IncomingMessage, client: Duplex, head: Buffer): void {
  const target = splitAuthority(req.url ?? '');
  if (!target) return refuseSocket(client, BAD_GATEWAY);
  tunnel(target.hostname, target.port, client, (upstream) => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
}

const HOP_BY_HOP = new Set([
  'proxy-connection',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
]);

/** Headers as received, without the ones that describe this hop rather than the request. */
function endToEnd(raw: string[], keepConnection = false): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const lower = raw[i].toLowerCase();
    if (HOP_BY_HOP.has(lower) && !(keepConnection && lower === 'connection')) continue;
    out.push(raw[i], raw[i + 1]);
  }
  return out;
}

/** A plain-HTTP request, which a browser sends to a proxy with the absolute URI. */
function onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const refuse = (status: number, denial?: EgressDeniedError) => {
    if (res.headersSent) return void res.destroy();
    res
      .writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        ...(denial ? { [EGRESS_POLICY_HEADER]: denial.rule } : {}),
      })
      .end(denial?.message ?? 'The runner could not reach this address.');
  };
  let url: URL;
  try {
    url = new URL(req.url ?? '');
  } catch {
    return refuse(BAD_GATEWAY);
  }
  const immediate = denialForHostname(url.hostname);
  if (immediate) return refuse(403, immediate);
  const upstream = http.request(
    {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port) || 80,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      // A flat [name, value, …] list keeps the browser's casing and order; Node accepts it.
      headers: endToEnd(req.rawHeaders) as unknown as http.OutgoingHttpHeaders,
      lookup: vettedLookup(),
      agent: false,
    },
    (answer) => {
      res.writeHead(
        answer.statusCode ?? BAD_GATEWAY,
        answer.statusMessage,
        endToEnd(answer.rawHeaders),
      );
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    const denial = egressDenialCause(error);
    refuse(denial ? 403 : BAD_GATEWAY, denial);
  });
  req.pipe(upstream);
}

/** A ws:// upgrade sent as a plain request rather than through CONNECT: relayed raw. */
function upgradeHead(req: http.IncomingMessage, url: URL): string {
  const lines = [`${req.method} ${url.pathname}${url.search} HTTP/1.1`];
  const headers = endToEnd(req.rawHeaders, true);
  for (let i = 0; i < headers.length; i += 2) lines.push(`${headers[i]}: ${headers[i + 1]}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function onUpgrade(req: http.IncomingMessage, client: Duplex, head: Buffer): void {
  let url: URL;
  try {
    url = new URL(req.url ?? '');
  } catch {
    return refuseSocket(client, BAD_GATEWAY);
  }
  tunnel(url.hostname, Number(url.port) || 80, client, (upstream) => {
    upstream.write(upgradeHead(req, url));
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
}

let listening: Promise<string> | undefined;

/** The guard proxy's origin, started on first use and kept for the life of the process. */
export function egressGuardProxyOrigin(): Promise<string> {
  listening ??= new Promise<string>((resolve, reject) => {
    const server = http.createServer(onRequest);
    server.on('connect', onConnect);
    server.on('upgrade', onUpgrade);
    server.on('clientError', (_error, socket) => socket.destroy());
    server.once('error', (error) => {
      listening = undefined;
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    });
  });
  return listening;
}

/**
 * Launch options for a browser the runner starts itself: behind WFM_EGRESS_PROXY when the
 * deployment has one, otherwise behind the guard proxy. `<-loopback>` removes the browsers'
 * implicit exemption of localhost, which would otherwise skip the policy for the runner's own
 * address.
 */
export async function guardedBrowserLaunchOptions(): Promise<LaunchOptions> {
  if (egressProxy()) return browserEgressOptions();
  return {
    proxy: { server: await egressGuardProxyOrigin(), bypass: '<-loopback>' },
    firefoxUserPrefs: { 'network.proxy.allow_hijacking_localhost': true },
  };
}
