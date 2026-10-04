import { isDeepStrictEqual } from 'node:util';
import type { ConversationPlan } from '@shared/protocol-conversation';
import { PROTOCOL_HARD_LIMITS } from '@shared/api-protocol-config';

export function protocolProperty(value: unknown, property?: string): unknown {
  if (!property || property === '$') return value;
  const parts = property
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.');
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Listener is attached before any send. The transcript and queue share bounded message objects. */
export class ProtocolInbox {
  readonly messages: unknown[] = [];
  readonly texts: string[] = [];
  private queue: unknown[] = [];
  private bytes = 0;
  private captureBytes = 0;
  private captureSizes = new Map<string, number>();
  private error?: Error;
  private ended = false;
  private wake?: () => void;
  constructor(private limits: { maxMessages: number; maxBytes: number }) {}
  capture(name: string, value: unknown) {
    const size = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(name);
    const next = this.captureBytes - (this.captureSizes.get(name) ?? 0) + size;
    if (next > this.limits.maxBytes) throw new Error('Protocol capture byte limit exceeded.');
    this.captureBytes = next;
    this.captureSizes.set(name, size);
  }
  push(value: unknown, text: string) {
    if (this.error) return;
    if (
      this.messages.length >= this.limits.maxMessages ||
      this.bytes + Buffer.byteLength(text) > this.limits.maxBytes
    ) {
      this.fail(new Error('Protocol response limit exceeded.'));
      throw this.error;
    }
    this.bytes += Buffer.byteLength(text);
    this.messages.push(value);
    this.texts.push(text);
    this.queue.push(value);
    this.wake?.();
  }
  fail(error: Error) {
    this.error = error;
    this.wake?.();
  }
  close() {
    this.ended = true;
    this.wake?.();
  }
  async receive(deadline: number): Promise<unknown> {
    while (true) {
      if (this.error) throw this.error;
      if (this.queue.length) return this.queue.shift();
      if (this.ended) throw new Error('Protocol closed before conversation completed.');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Conversation receive timeout.');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.wake = undefined;
          reject(new Error('Conversation receive timeout.'));
        }, remaining);
        this.wake = () => {
          clearTimeout(timer);
          this.wake = undefined;
          resolve();
        };
      });
    }
  }
}

export function substituteConversation(
  value: unknown,
  variables: Record<string, string>,
  captures: Record<string, unknown>,
): unknown {
  if (typeof value === 'string')
    return value.replace(/\{\{([^{}]+)\}\}/g, (_match, name: string) => {
      if (name.startsWith('capture.')) {
        const key = name.slice(8);
        if (!Object.hasOwn(captures, key)) throw new Error(`Missing conversation capture ${key}.`);
        const captured = captures[key];
        return typeof captured === 'string' ? captured : JSON.stringify(captured);
      }
      if (!Object.hasOwn(variables, name))
        throw new Error(`Missing conversation variable ${name}.`);
      return variables[name];
    });
  if (Array.isArray(value)) return value.map((v) => substituteConversation(v, variables, captures));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteConversation(v, variables, captures)]),
    );
  return value;
}

export async function executeConversation(
  plan: ConversationPlan,
  inbox: ProtocolInbox,
  deadline: number,
  send: (message: unknown) => Promise<void>,
  end: () => void,
  variables: Record<string, string> = {},
) {
  const captures: Record<string, unknown> = Object.create(null);
  let sentBytes = 0;
  let accepted: unknown;
  for (const [index, step] of plan.steps.entries()) {
    try {
      if (Date.now() >= deadline) throw new Error('Conversation overall timeout.');
      if (step.type === 'send') {
        const message = substituteConversation(step.message, variables, captures);
        sentBytes += Buffer.byteLength(JSON.stringify(message));
        if (sentBytes > PROTOCOL_HARD_LIMITS.maxBytes) throw new Error('Conversation request byte limit exceeded.');
        await send(message);
      }
      if (step.type === 'end') end();
      if (step.type === 'receive') {
        const receiveDeadline = Math.min(
          deadline,
          Date.now() + (step.timeoutMs ?? deadline - Date.now()),
        );
        do {
          accepted = await inbox.receive(receiveDeadline);
        } while (
          Object.hasOwn(step, 'equals') &&
          !isDeepStrictEqual(protocolProperty(accepted, step.property), step.equals)
        );
        if (step.property && protocolProperty(accepted, step.property) === undefined)
          throw new Error('Receive property is missing.');
      }
      if (step.type === 'capture') {
        const value = protocolProperty(accepted, step.property);
        if (value === undefined) throw new Error(`Capture ${step.name} property is missing.`);
        const captured = step.property
          ? value
          : typeof accepted === 'string'
            ? accepted
            : JSON.stringify(accepted);
        inbox.capture(step.name, captured);
        captures[step.name] = captured;
      }
    } catch (error) {
      throw new Error(`Conversation step ${index + 1}: ${(error as Error).message}`);
    }
  }
  return captures;
}
