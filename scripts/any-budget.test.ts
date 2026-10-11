import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countAny, measure } from './any-budget.mjs';

describe('any budget', () => {
  it('counts the any type wherever it is written, and nothing else', () => {
    const source = [
      'const a: any = 1;',
      'const b = a as any;',
      'function f(x: any[], y: Record<string, any>): Promise<any> { return x as never; }',
      "const company = 'any'; // any in a comment or a string is not a type",
      'type Many = { anything: unknown };',
    ].join('\n');
    expect(countAny('x.ts', source)).toBe(5);
    expect(countAny('x.tsx', 'const C = (p: any) => <div {...p} />;')).toBe(1);
  });

  it('matches the committed budget', () => {
    // The CI step fails as well; this keeps `npm test` honest on its own.
    const budget = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'any-budget.json'), 'utf8'),
    ) as Record<string, number>;
    expect(measure().totals).toEqual(budget);
  });
});
