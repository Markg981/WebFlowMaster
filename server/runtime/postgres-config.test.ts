import { describe, expect, it } from 'vitest';
import { postgresConfig } from './database-step';
import { redactString } from '../platform/utils/log-redactor';
import { buildPrompt } from '../authoring/nl-authoring';

describe('postgresConfig', () => {
  it('builds the config from the address fields and ignores ssl file and host overrides', () => {
    const config = postgresConfig(
      'postgres://qa:s3cr%40t@db.example:6543/shop?sslrootcert=/etc/passwd&sslkey=/x&host=evil&port=1&user=root',
    );
    expect(config).toEqual({
      host: 'db.example',
      port: 6543,
      user: 'qa',
      password: 's3cr@t',
      database: 'shop',
    });
  });

  it('keeps the ssl mode', () => {
    expect(postgresConfig('postgres://h/db?sslmode=require').ssl).toBe(true);
    expect(postgresConfig('postgres://h/db?sslmode=disable').ssl).toBe(false);
  });
});

describe('log redactor URL credentials', () => {
  it('masks user:password in a URL', () => {
    expect(redactString('connect postgres://qa:hunter2@db:5432/x failed')).toBe(
      'connect postgres://[REDACTED]@db:5432/x failed',
    );
  });
});

describe('NL authoring prompt', () => {
  it('does not offer code or SQL actions', () => {
    const prompt = buildPrompt([{ line: 1, text: 'click Save' }], []);
    expect(prompt).not.toMatch(/executeScript|queryDatabase/);
    expect(prompt).toContain('- click');
  });
});
