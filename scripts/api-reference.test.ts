import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { constraints, inline, typeOf } from './generate-api-reference';

/**
 * docs/{en,it}/reference/api-endpoints.md and docs/public/openapi.json are generated from
 * server/api-v1/openapi.ts. A route added without regenerating them fails here, not in front of a
 * customer reading the reference.
 */
describe('generated API reference', () => {
  it('matches server/api-v1/openapi.ts', () => {
    const root = path.resolve(__dirname, '..');
    expect(() =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-api-reference.ts', '--check'],
        { cwd: root, stdio: 'pipe' },
      ),
    ).not.toThrow();
  }, 60_000);

  it('keeps table cells safe for Markdown and Vue', () => {
    expect(inline('Use <key> | {{name}} or `a|b`\nnext')).toBe(
      'Use &lt;key&gt; \\| &#123;&#123;name}} or <code>a&#124;b</code> next',
    );
    // A backslash is escaped too, so an existing "\|" cannot turn back into a cell break.
    expect(inline('a \\| b and `c\\d` and `plain`')).toBe(
      'a \\\\\\| b and <code>c&#92;d</code> and `plain`',
    );
  });

  it('names types the way a reader looks for them', () => {
    expect(typeOf({ $ref: '#/components/schemas/Run' })).toBe('[Run](#schema-run)');
    expect(typeOf({ type: 'array', items: { $ref: '#/components/schemas/Tag' } })).toBe(
      '[Tag](#schema-tag)[]',
    );
    expect(typeOf({ type: ['string', 'null'], format: 'date-time' })).toBe(
      'string (date-time) \\| null',
    );
    expect(typeOf({ type: 'string', enum: ['a', 'b'] })).toBe('one of `a`, `b`');
    expect(
      typeOf({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
      }),
    ).toBe('object { items: string[], limit }');
    expect(constraints({ type: 'integer', minimum: 1, maximum: 100, default: 20 })).toBe(
      '1–100, default `20`',
    );
  });
});
