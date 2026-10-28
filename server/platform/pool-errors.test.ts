import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { attachPoolErrorHandler } from './pool-errors';

describe('attachPoolErrorHandler', () => {
  it('handles an error emitted on an idle connection without throwing', () => {
    const pool = attachPoolErrorHandler(
      new Pool({ connectionString: 'postgres://x@localhost/x' }),
      'test',
    );
    expect(pool.listenerCount('error')).toBe(1);
    expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
  });

  it('is used by every new Pool( in server/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__repro__') walk(full);
        } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/new (pg\.)?Pool\(/.test(text) && !text.includes('attachPoolErrorHandler('))
            offenders.push(full);
        }
      }
    };
    walk(path.resolve(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
});
