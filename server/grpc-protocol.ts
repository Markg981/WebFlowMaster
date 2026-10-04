import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import type { ProtocolResponse } from '@shared/agent-protocol';
import {
  protocolLimits,
  ResolvedProtocolConfigSchema,
  PROTOCOL_HARD_LIMITS,
  type ResolvedProtocolConfig,
} from '@shared/api-protocol-config';
import { readConversationPlan } from '@shared/protocol-conversation';
import { grpcEgressTarget } from './egress-proxy';
import {
  ProtocolInbox,
  executeConversation,
  substituteConversation,
} from './protocol-conversation';

export interface GrpcInput {
  url: URL;
  proto: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
  config?: ResolvedProtocolConfig;
  variables?: Record<string, string>;
}

export async function grpcModeFor(
  proto: string,
  url: URL,
): Promise<'unary' | 'server_stream' | 'client_stream' | 'bidi'> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfm-proto-mode-'));
  try {
    const file = path.join(dir, 'service.proto');
    await writeFile(file, proto);
    const definition = loader.loadSync(file);
    const [serviceName, methodName] = url.pathname.replace(/^\/+/, '').split('/');
    const service = definition[serviceName] as grpc.ServiceDefinition | undefined;
    const method = service && !('format' in service) ? service[methodName] : undefined;
    if (!method?.path)
      throw new Error('Selected gRPC service or method is missing from the proto.');
    return method.requestStream
      ? method.responseStream
        ? 'bidi'
        : 'client_stream'
      : method.responseStream
        ? 'server_stream'
        : 'unary';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function grpcCredentials(
  config: ResolvedProtocolConfig | undefined,
  tls: boolean,
): grpc.ChannelCredentials {
  const validated = ResolvedProtocolConfigSchema.parse(config ?? {});
  if (validated.tls && !tls) throw new Error('TLS configuration requires grpcs://.');
  if (!tls) return grpc.credentials.createInsecure();
  const material = validated.tls;
  if (!material) return grpc.credentials.createSsl();
  try {
    if (
      Object.values(material).some(
        (value) => value && Buffer.byteLength(value) > PROTOCOL_HARD_LIMITS.maxPemBytes,
      )
    )
      throw new Error();
    if (material.rootCa) {
      const blocks = material.rootCa.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
      );
      if (
        !blocks?.length ||
        material.rootCa
          .replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '')
          .trim()
      )
        throw new Error();
      blocks.forEach((block) => new X509Certificate(block));
    }
    let key: Buffer | undefined;
    if (material.clientCertificate && material.clientKey) {
      const cert = new X509Certificate(material.clientCertificate);
      const privateKey = createPrivateKey({
        key: material.clientKey,
        passphrase: material.keyPassphrase,
      });
      if (!cert.checkPrivateKey(privateKey)) throw new Error();
      key = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    }
    return grpc.credentials.createSsl(
      material.rootCa ? Buffer.from(material.rootCa) : undefined,
      key,
      material.clientCertificate ? Buffer.from(material.clientCertificate) : undefined,
    );
  } catch {
    throw new Error('Invalid gRPC TLS certificate, private key or passphrase.');
  }
}

const metadataMap = (metadata?: grpc.Metadata) =>
  Object.fromEntries(Object.entries(metadata?.getMap() ?? {}).map(([k, v]) => [k, String(v)]));

export async function executeGrpc(input: GrpcInput): Promise<ProtocolResponse> {
  const parts = input.url.pathname.replace(/^\/+/, '').split('/');
  if (
    !['grpc:', 'grpcs:'].includes(input.url.protocol) ||
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1]
  )
    throw new Error(
      'Name the method in the gRPC address: grpc://host:port/package.Service/Method.',
    );
  if (!input.proto.trim())
    throw new Error('A gRPC test needs the .proto that describes the service.');
  const limits = protocolLimits(input.config, input.timeoutMs);
  const deadline = Date.now() + limits.timeoutMs;
  const credentials = grpcCredentials(input.config, input.url.protocol === 'grpcs:');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfm-proto-'));
  let client: grpc.Client | undefined;
  try {
    const file = path.join(dir, 'service.proto');
    await writeFile(file, input.proto);
    let definition: loader.PackageDefinition;
    try {
      definition = loader.loadSync(file, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
    } catch {
      throw new Error('The .proto could not be read.');
    }
    const service = definition[parts[0]] as grpc.ServiceDefinition | undefined;
    if (!service || 'format' in service) throw new Error(`No service ${parts[0]} in the .proto.`);
    const method = service[parts[1]];
    if (!method?.path) throw new Error(`No method ${parts[1]} in ${parts[0]}.`);
    const mode = method.requestStream
      ? method.responseStream
        ? 'bidi'
        : 'client_stream'
      : method.responseStream
        ? 'server_stream'
        : 'unary';
    if (
      input.config?.grpcMode &&
      input.config.grpcMode !== 'auto' &&
      input.config.grpcMode !== mode
    )
      throw new Error('Configured gRPC mode does not match the proto method.');
    let request: unknown;
    try {
      request = input.body.trim() ? JSON.parse(input.body) : {};
    } catch {
      throw new Error('The request of a gRPC test is JSON.');
    }
    const plan = method.requestStream ? readConversationPlan(input.body) : undefined;
    let messages: unknown[] = [];
    if (method.requestStream && !plan) {
      if (
        !request ||
        typeof request !== 'object' ||
        !Array.isArray((request as { messages?: unknown }).messages) ||
        Object.keys(request).some((k) => k !== 'messages')
      )
        throw new Error('A request stream requires {messages:[...]} or a conversation plan.');
      messages = (request as { messages: unknown[] }).messages;
      if (messages.length > 1000 || Buffer.byteLength(input.body) > 8 * 1024 * 1024)
        throw new Error('Request stream limit exceeded.');
    }
    if (
      plan &&
      !method.responseStream &&
      plan.steps.some((step) => step.type === 'receive' || step.type === 'capture')
    )
      throw new Error('Client-streaming conversations cannot receive before the single response.');
    const Client = grpc.makeGenericClientConstructor({ [parts[1]]: method }, parts[0]);
    const connection = grpcEgressTarget(input.url.host, input.url.hostname);
    client = new Client(connection.address, credentials, connection.options);
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(input.headers))
      metadata.set(key.toLowerCase(), value);
    return await new Promise<ProtocolResponse>((resolve, reject) => {
      const inbox = new ProtocolInbox(limits);
      const headers: Record<string, string> = {};
      let response: unknown;
      let localError: Error | undefined;
      let settled = false;
      let captures: Record<string, unknown> = {};
      let workComplete = !method.requestStream;
      let terminal: grpc.StatusObject | undefined;
      const finish = () => {
        if (settled || !terminal || (!workComplete && terminal.code === 0)) return;
        settled = true;
        input.signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        inbox.close();
        if (localError) {
          reject(localError);
          return;
        }
        Object.assign(headers, metadataMap(terminal.metadata));
        const body = method.responseStream
          ? {
              messages: inbox.messages,
              last: inbox.messages.at(-1) ?? null,
              count: inbox.messages.length,
              captures,
            }
          : terminal.code === 0
            ? response
            : { error: terminal.details };
        resolve({
          status: terminal.code,
          statusText:
            terminal.code === 0
              ? 'OK'
              : `${grpc.status[terminal.code] ?? terminal.code}: ${terminal.details}`,
          headers,
          body,
          text: method.responseStream
            ? inbox.texts.join('\n')
            : terminal.code === 0
              ? JSON.stringify(body)
              : terminal.details,
        });
      };
      const fail = (error: Error) => {
        if (settled) return;
        localError = error;
        workComplete = true;
        inbox.fail(error);
        call.cancel();
        if (terminal) finish();
      };
      const callback = (error: grpc.ServiceError | null, value: unknown) => {
        response = value;
        if (error) Object.assign(headers, metadataMap(error.metadata));
        else
          try {
            inbox.push(value, JSON.stringify(value));
          } catch (error) {
            fail(error as Error);
          }
      };
      const invoke = (
        client as unknown as Record<
          string,
          (
            ...args: unknown[]
          ) =>
            | grpc.ClientUnaryCall
            | grpc.ClientReadableStream<unknown>
            | grpc.ClientWritableStream<unknown>
            | grpc.ClientDuplexStream<unknown, unknown>
        >
      )[parts[1]].bind(client);
      const call = method.requestStream
        ? method.responseStream
          ? invoke(metadata, { deadline })
          : invoke(metadata, { deadline }, callback)
        : method.responseStream
          ? invoke(request, metadata, { deadline })
          : invoke(request, metadata, { deadline }, callback);
      const onAbort = () => fail(new Error('Protocol execution aborted.'));
      input.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => {
          localError = new Error('gRPC execution deadline exceeded.');
          call.cancel();
          if (!terminal) {
            terminal = {
              code: grpc.status.DEADLINE_EXCEEDED,
              details: 'Deadline exceeded',
              metadata: new grpc.Metadata(),
            };
            workComplete = true;
            finish();
          }
        },
        Math.max(1, deadline - Date.now()),
      );
      call.on('metadata', (m: grpc.Metadata) => Object.assign(headers, metadataMap(m)));
      call.on('data', (value: unknown) => {
        try {
          inbox.push(value, JSON.stringify(value));
        } catch (error) {
          fail(error as Error);
        }
      });
      call.on('error', () => {}); // status owns remote errors; always install before request writes.
      call.on('status', (status: grpc.StatusObject) => {
        if (status.code === grpc.status.DEADLINE_EXCEEDED && Date.now() >= deadline) {
          localError ??= new Error('gRPC execution deadline exceeded.');
        }
        terminal = status;
        inbox.close();
        finish();
      });
      if (input.signal?.aborted) onAbort();
      if (method.requestStream) {
        const stream = call as grpc.ClientWritableStream<unknown>;
        const write = async (value: unknown) => {
          if (localError) throw localError;
          await new Promise<void>((res, rej) => {
            const done = (error?: Error | null) =>
              error ? rej(new Error('gRPC request stream write failed.')) : res();
            stream.write(value, done);
          });
        };
        // write callbacks provide backpressure and reject when cancellation closes the stream.
        void (async () => {
          if (plan)
            captures = await executeConversation(
              plan,
              inbox,
              deadline,
              write,
              () => stream.end(),
              input.variables,
            );
          else
            for (const message of messages)
              await write(substituteConversation(message, input.variables ?? {}, {}));
          if (!stream.writableEnded) stream.end();
          workComplete = true;
          finish();
        })().catch((error) => fail(error as Error));
      }
    });
  } finally {
    client?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
