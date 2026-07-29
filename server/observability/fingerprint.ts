import { createHash } from 'node:crypto';
import type { IncidentKind, StackFrame } from '../../shared/observability';

/** How many leading app frames take part in the fingerprint. */
const FRAMES_IN_FINGERPRINT = 3;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX = /\b[0-9a-f]{12,}\b/gi;
// The lookbehind is what separates a filesystem path from the slashes inside a URL:
// a real path never follows ":", a word character, or another "/". Without it the
// pattern swallows "//host/api/orders" whole, and two different failing endpoints
// collapse into one fingerprint.
const ABSOLUTE_PATH = /(?<![:\w/])(?:[A-Za-z]:\\|\/)[^\s"')]+/g;
// Intentionally unanchored: in "1523ms" the digits are followed by a word
// character, so a word-boundary anchor would leave the number in place.
const NUMBER = /\d+/g;

/**
 * Collapses the parts of a message that vary between occurrences of the same bug —
 * ids, timings, paths — so fifty occurrences share one fingerprint instead of
 * producing fifty near-identical incident files.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(UUID, '<uuid>')
    .replace(ABSOLUTE_PATH, '<path>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, '<n>')
    .trim();
}

export function fingerprintError(input: {
  kind: IncidentKind;
  message: string;
  frames: StackFrame[];
}): string {
  const appFrames = input.frames
    .filter((f) => f.app)
    .slice(0, FRAMES_IN_FINGERPRINT)
    .map((f) => `${f.file}:${f.line}`);

  const material = [input.kind, normaliseMessage(input.message), ...appFrames].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/** Incident ids are short on purpose: they appear in log lines and filenames. */
export function incidentIdFromFingerprint(fingerprint: string): string {
  return `inc_${fingerprint.slice(0, 6)}`;
}
