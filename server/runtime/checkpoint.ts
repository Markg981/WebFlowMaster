import { createHash } from 'node:crypto';
import { MAX_CHECKPOINT_BYTES, MAX_TEXT_MATCHES, type CheckpointCapture } from '@shared/comparison';
import { canonical } from '../authoring/step-provenance';

/**
 * What a checkpoint step keeps for a run comparison to pair and diff (shared/comparison.ts).
 *
 * The data is bounded here, once, so neither the step result nor the comparison ever holds more
 * than MAX_CHECKPOINT_BYTES of it; a cut capture says so, and the comparison reports it rather
 * than calling two cut captures equal.
 */

const canonicalJson = (value: unknown) => JSON.stringify(canonical(value)) ?? 'null';

/** sha-256 of the canonical JSON of a checkpoint's data. */
export function checkpointHash(data: unknown): string {
  return createHash('sha256').update(canonicalJson(data)).digest('hex');
}

/** Whitespace runs as one space, ends trimmed: layout differences are not content differences. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value), 'utf8');

/** A text checkpoint over every match's inner text, normalised and bounded. */
export function textCheckpoint(name: string, rawTexts: readonly string[]): CheckpointCapture {
  let truncated = rawTexts.length > MAX_TEXT_MATCHES;
  const texts = rawTexts.slice(0, MAX_TEXT_MATCHES).map(normaliseText);
  // Whole texts go first, from the end; a single text too long on its own is cut.
  while (texts.length > 1 && bytes({ texts }) > MAX_CHECKPOINT_BYTES) {
    texts.pop();
    truncated = true;
  }
  if (texts.length === 1 && bytes({ texts }) > MAX_CHECKPOINT_BYTES) {
    let text = texts[0];
    while (text.length > 0 && bytes({ texts: [text] }) > MAX_CHECKPOINT_BYTES) {
      text = text.slice(0, Math.floor(text.length * 0.9));
    }
    texts[0] = text;
    truncated = true;
  }
  const data = { texts };
  return {
    name,
    kind: 'text',
    data,
    hash: checkpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}
