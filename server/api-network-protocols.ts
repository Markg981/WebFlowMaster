import os from 'os';
import path from 'path';
import fs from 'node:fs/promises';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { egressProxy, grpcEgressTarget } from './egress-proxy';
import type { ProtocolResponse } from '@shared/agent-protocol';

/** What a WebSocket test sends, and how long it listens: lines, or {"send": [...], "waitMs": …, "until": n}. */
export function readWebSocketPlan(body: string): { send: string[]; waitMs: number; until?: number } {
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
export async function runWebSocket(input: { url: string; headers: Record<string, string>; body: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProtocolResponse> {
  const plan = readWebSocketPlan(input.body);
  const received: string[] = [];
  return new Promise<ProtocolResponse>((resolve, reject) => {
    let settled = false;
    let closeInfo = { code: 0, reason: '' };
    const proxy = egressProxy();
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const socket = new WebSocket(input.url, { headers: input.headers, handshakeTimeout: input.timeoutMs, ...(agent ? { agent } : {}) });
    socket.once('close', () => agent?.destroy());
    const onAbort = () => socket.terminate();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('close', () => input.signal?.removeEventListener('abort', onAbort));
    if (input.signal?.aborted) socket.terminate();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000); } catch { /* already closed */ }
      const messages = received.map(parsed);
      resolve({
        status: 101,
        statusText: closeInfo.code ? `Closed ${closeInfo.code}${closeInfo.reason ? ` ${closeInfo.reason}` : ''}` : 'Switching Protocols',
        headers: {},
        body: { messages, last: messages[messages.length - 1] ?? null, count: messages.length },
        text: received.join('\n'),
      });
    };
    let timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.terminate();
        reject(new Error(`Could not connect to ${input.url} within ${Math.round(input.timeoutMs / 1000)} s.`));
      }
    }, input.timeoutMs);
    socket.on('open', () => {
      clearTimeout(timer);
      for (const message of plan.send) socket.send(message);
      timer = setTimeout(finish, plan.waitMs);
      if (plan.until !== undefined && received.length >= plan.until) finish();
    });
    socket.on('message', (data) => {
      received.push(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
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

/** grpc://host:port/package.Service/Method, or grpcs:// for TLS. */
export function parseGrpcTarget(url: URL): { address: string; tls: boolean; service: string; method: string } | { error: string } {
  if (url.protocol !== 'grpc:' && url.protocol !== 'grpcs:') return { error: 'A gRPC address starts with grpc:// or grpcs://.' };
  const parts = url.pathname.replace(/^\/+/, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: 'Name the method in the address: grpc://host:port/package.Service/Method.' };
  return { address: url.host || `${url.hostname}:${url.port}`, tls: url.protocol === 'grpcs:', service: parts[0], method: parts[1] };
}

const GRPC_STATUS = ['OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED'];

/**
 * One unary call. The status is the gRPC status code (0 for OK), the headers the response metadata,
 * the body the response message as JSON. A call the server answers with an error status is a
 * response, not a failure to run: assert on `status_code` to expect one.
 */
export async function runGrpc(input: { url: URL; proto: string; headers: Record<string, string>; body: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProtocolResponse> {
  const target = parseGrpcTarget(input.url);
  if ('error' in target) throw new Error(target.error);
  if (!input.proto.trim()) throw new Error('A gRPC test needs the .proto that describes the service.');
  const grpc = await import('@grpc/grpc-js');
  const loader = await import('@grpc/proto-loader');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-proto-'));
  const file = path.join(dir, 'service.proto');
  try {
    await fs.writeFile(file, input.proto);
    let definition: ReturnType<typeof loader.loadSync>;
    try {
      definition = loader.loadSync(file, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    } catch (error) {
      throw new Error(`The .proto could not be read: ${(error as Error).message}`);
    }
    const service = definition[target.service] as { [method: string]: { requestStream?: boolean; responseStream?: boolean; path?: string } } | undefined;
    // In a package definition a message type carries `format`; a service is a map of methods.
    if (!service || typeof service !== 'object' || 'format' in service) {
      const known = Object.keys(definition).filter((k) => !('format' in (definition[k] as object)));
      throw new Error(`No service ${target.service} in the .proto. It defines: ${known.join(', ') || 'no services'}.`);
    }
    const method = service[target.method];
    if (!method || typeof method !== 'object' || !method.path) throw new Error(`No method ${target.method} in ${target.service}.`);
    if (method.requestStream || method.responseStream) throw new Error(`${target.method} streams; only unary calls are supported.`);
    let request: unknown = {};
    if (input.body.trim()) {
      try {
        request = JSON.parse(input.body);
      } catch {
        throw new Error('The request of a gRPC test is the message as JSON.');
      }
    }
    const Client = grpc.makeGenericClientConstructor({ [target.method]: method as never }, target.service);
    const connection = grpcEgressTarget(target.address, input.url.hostname);
    const client = new Client(connection.address, target.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(), connection.options);
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(input.headers)) metadata.set(key.toLowerCase(), value);
    try {
      return await new Promise<ProtocolResponse>((resolve) => {
        const headers: Record<string, string> = {};
        let onAbort = () => {};
        const call = (client as unknown as Record<string, (...args: unknown[]) => { cancel(): void; on(event: string, listener: (m: { getMap(): Record<string, unknown> }) => void): void }>)[target.method](
          request,
          metadata,
          { deadline: Date.now() + input.timeoutMs },
          (error: (Error & { code?: number; details?: string; metadata?: { getMap(): Record<string, unknown> } }) | null, response: unknown) => {
            input.signal?.removeEventListener('abort', onAbort);
            if (error) {
              const code = error.code ?? 2;
              Object.assign(headers, Object.fromEntries(Object.entries(error.metadata?.getMap() ?? {}).map(([k, v]) => [k, String(v)])));
              resolve({ status: code, statusText: `${GRPC_STATUS[code] ?? code}: ${error.details ?? error.message}`, headers, body: { error: error.details ?? error.message }, text: error.details ?? error.message });
              return;
            }
            const text = JSON.stringify(response);
            resolve({ status: 0, statusText: 'OK', headers, body: response, text });
          },
        );
        onAbort = () => call.cancel();
        input.signal?.addEventListener('abort', onAbort, { once: true });
        if (input.signal?.aborted) call.cancel();
        call.on('metadata', (m: { getMap(): Record<string, unknown> }) => {
          for (const [k, v] of Object.entries(m.getMap())) headers[k] = String(v);
        });
      });
    } finally {
      client.close();
    }
  } finally {
    await fs.rm(file, { force: true });
    await fs.rmdir(dir);
  }
}
