import { describe, expect, it } from 'vitest';
import { MAX_CHECKPOINT_BYTES, MAX_TEXT_MATCHES } from '@shared/comparison';
import { checkpointHash, normaliseText, textCheckpoint } from './checkpoint';

describe('textCheckpoint', () => {
  it('normalises whitespace and hashes the canonical data', () => {
    const capture = textCheckpoint('total', ['  € 12,50\n', 'a\t\tb']);
    expect(capture).toEqual({
      name: 'total',
      kind: 'text',
      data: { texts: ['€ 12,50', 'a b'] },
      hash: checkpointHash({ texts: ['€ 12,50', 'a b'] }),
    });
    expect(capture.truncated).toBeUndefined();
  });

  it('hashes the same texts the same way, and different ones differently', () => {
    expect(textCheckpoint('a', ['x  y']).hash).toBe(textCheckpoint('b', ['x y']).hash);
    expect(textCheckpoint('a', ['x']).hash).not.toBe(textCheckpoint('a', ['y']).hash);
  });

  it('keeps at most MAX_TEXT_MATCHES texts and marks the cut', () => {
    const capture = textCheckpoint('rows', Array.from({ length: MAX_TEXT_MATCHES + 5 }, String));
    expect((capture.data as { texts: string[] }).texts).toHaveLength(MAX_TEXT_MATCHES);
    expect(capture.truncated).toBe(true);
  });

  it('stays within MAX_CHECKPOINT_BYTES, cutting a single long text too', () => {
    const many = textCheckpoint(
      'many',
      Array.from({ length: 100 }, () => 'x'.repeat(2000)),
    );
    expect(Buffer.byteLength(JSON.stringify(many.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(many.truncated).toBe(true);

    const one = textCheckpoint('one', ['é'.repeat(MAX_CHECKPOINT_BYTES)]);
    expect(Buffer.byteLength(JSON.stringify(one.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect((one.data as { texts: string[] }).texts[0].length).toBeGreaterThan(0);
    expect(one.truncated).toBe(true);
  });

  it('records an empty match list as no texts', () => {
    expect(textCheckpoint('none', []).data).toEqual({ texts: [] });
    expect(normaliseText('\n \t')).toBe('');
  });
});
