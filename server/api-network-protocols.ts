import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { egressProxy } from './egress-proxy';
import type { ProtocolResponse } from '@shared/agent-protocol';
import { protocolLimits, type ResolvedProtocolConfig } from '@shared/api-protocol-config';
import { readConversationPlan } from '@shared/protocol-conversation';
import { ProtocolInbox, executeConversation } from './protocol-conversation';

/** What a WebSocket test sends, and how long it listens: lines, or {"send": [...], "waitMs": …, "until": n}. */
export function readWebSocketPlan(body: string): {
  send: string[];
  waitMs: number;
  until?: number;
} {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const plan = JSON.parse(trimmed);
      if (plan && Array.isArray(plan.send)) {
        return {
          send: plan.send.map((m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m))),
          waitMs: Math.min(Math.max(Number(plan.waitMs) || 2000, 0), 60_000),
          until: Number.isInteger(plan.until) && plan.until > 0 ? plan.until : undefined,
        };
      }
    } catch {
      // Not a plan: one JSON message, sent as it is.
    }
    return { send: [trimmed], waitMs: 2000 };
  }
  return { send: trimmed ? trimmed.split(/\r?\n/).filter((l) => l.trim()) : [], waitMs: 2000 };
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Connects, sends the messages in order, and collects the messages received until `until` of them
 * arrived or `waitMs` passed. The body is { messages, last, count }: `last.type` or
 * `messages[0].id` read with a JSON path, `count` compared with a number.
 */
export async function runWebSocket(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
  config?: ResolvedProtocolConfig;
  variables?: Record<string, string>;
}): Promise<ProtocolResponse> {
  const limits = protocolLimits(input.config, input.timeoutMs);
  input = { ...input, timeoutMs: limits.timeoutMs };
  const conversation = readConversationPlan(input.body);
  if (conversation) return runWebSocketConversation(input, conversation, limits);
  const plan = readWebSocketPlan(input.body);
  const deadline = Date.now() + limits.timeoutMs;
  const received: string[] = [];
  return new Promise<ProtocolResponse>((resolve, reject) => {
    let settled = false;
    let closeInfo = { code: 0, reason: '' };
    const proxy = egressProxy();
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const socket = new WebSocket(input.url, {
      headers: input.headers,
      handshakeTimeout: input.timeoutMs,
      ...(agent ? { agent } : {}),
    });
    socket.once('close', () => agent?.destroy());
    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.terminate();
        reject(new Error('Protocol execution aborted.'));
      }
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('close', () => input.signal?.removeEventListener('abort', onAbort));
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close(1000);
      } catch {
        /* already closed */
      }
      const messages = received.map(parsed);
      resolve({
        status: 101,
        statusText: closeInfo.code
          ? `Closed ${closeInfo.code}${closeInfo.reason ? ` ${closeInfo.reason}` : ''}`
          : 'Switching Protocols',
        headers: {},
        body: { messages, last: messages[messages.length - 1] ?? null, count: messages.length },
        text: received.join('\n'),
      });
    };
    let timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.terminate();
        reject(
          new Error(
            `Could not connect to ${input.url} within ${Math.round(input.timeoutMs / 1000)} s.`,
          ),
        );
      }
    }, input.timeoutMs);
    if (input.signal?.aborted) onAbort();
    socket.on('open', () => {
      clearTimeout(timer);
      for (const message of plan.send) socket.send(message);
      timer = setTimeout(finish, Math.min(plan.waitMs, Math.max(0, deadline - Date.now())));
      if (plan.until !== undefined && received.length >= plan.until) finish();
    });
    socket.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (
        received.length >= limits.maxMessages ||
        received.reduce((sum, item) => sum + Buffer.byteLength(item), 0) + Buffer.byteLength(text) >
          limits.maxBytes
      ) {
        settled = true;
        clearTimeout(timer);
        socket.terminate();
        reject(new Error('Protocol response limit exceeded.'));
        return;
      }
      received.push(text);
      if (plan.until !== undefined && received.length >= plan.until) finish();
    });
    socket.on('close', (code, reason) => {
      closeInfo = { code, reason: reason.toString() };
      finish();
    });
    socket.on('unexpected-response', (_req, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      agent?.destroy();
      reject(new Error(`The server refused the WebSocket connection: HTTP ${res.statusCode}.`));
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      agent?.destroy();
      reject(new Error(`WebSocket error: ${error.message}`));
    });
  });
}

async function runWebSocketConversation(
  input: Parameters<typeof runWebSocket>[0],
  plan: NonNullable<ReturnType<typeof readConversationPlan>>,
  limits: ReturnType<typeof protocolLimits>,
): Promise<ProtocolResponse> {
  const deadline = Date.now() + limits.timeoutMs;
  const inbox = new ProtocolInbox(limits);
  const proxy = egressProxy();
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  const socket = new WebSocket(input.url, {
    headers: input.headers,
    handshakeTimeout: limits.timeoutMs,
    maxPayload: limits.maxBytes,
    ...(agent ? { agent } : {}),
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    const cleanup = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      agent?.destroy();
      socket.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      inbox.fail(error);
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error('Protocol execution aborted.'));
    const timer = setTimeout(
      () => fail(new Error('Conversation overall timeout.')),
      limits.timeoutMs,
    );
    input.signal?.addEventListener('abort', onAbort, { once: true });
    socket.on('message', (data) => {
      try {
        const text = data.toString();
        inbox.push(parsed(text), text);
      } catch (error) {
        fail(error as Error);
      }
    });
    socket.on('close', () => {
      inbox.close();
      if (!settled && !opened)
        fail(new Error('Conversation step 1: Protocol closed before conversation completed.'));
    });
    socket.on('error', () => fail(new Error('WebSocket connection failed.')));
    socket.on('unexpected-response', (_req, res) =>
      fail(new Error(`The server refused the WebSocket connection: HTTP ${res.statusCode}.`)),
    );
    socket.once('open', () => {
      opened = true;
      void executeConversation(
        plan,
        inbox,
        deadline,
        (message) =>
          new Promise<void>((res, rej) =>
            socket.send(typeof message === 'string' ? message : JSON.stringify(message), (error) =>
              error ? rej(new Error('WebSocket send failed.')) : res(),
            ),
          ),
        () => {},
        input.variables,
      )
        .then((captures) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            status: 101,
            statusText: 'Switching Protocols',
            headers: {},
            body: {
              messages: inbox.messages,
              last: inbox.messages.at(-1) ?? null,
              count: inbox.messages.length,
              captures,
            },
            text: inbox.texts.join('\n'),
          });
        })
        .catch((error) => fail(error as Error));
    });
    if (input.signal?.aborted) onAbort();
  });
}

/** grpc://host:port/package.Service/Method, or grpcs:// for TLS. */
export function parseGrpcTarget(
  url: URL,
): { address: string; tls: boolean; service: string; method: string } | { error: string } {
  if (url.protocol !== 'grpc:' && url.protocol !== 'grpcs:')
    return { error: 'A gRPC address starts with grpc:// or grpcs://.' };
  const parts = url.pathname.replace(/^\/+/, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { error: 'Name the method in the address: grpc://host:port/package.Service/Method.' };
  return {
    address: url.host || `${url.hostname}:${url.port}`,
    tls: url.protocol === 'grpcs:',
    service: parts[0],
    method: parts[1],
  };
}

export { executeGrpc as runGrpc } from './grpc-protocol';
