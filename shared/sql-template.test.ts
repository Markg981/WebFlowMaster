import { describe, it, expect } from 'vitest';
import { bindSql, placeholderNames, placeholderProblems, splitBatches } from './sql-template';

const vars: Record<string, unknown> = {
  'params.email': 'ann@shop.test',
  'params.n': 3,
  'run.tag': 'r1',
};
const resolve = (name: string) => vars[name];

describe('splitBatches', () => {
  it('splits on GO lines, any case, with a trailing comment', () => {
    expect(splitBatches('SELECT 1\nGO\nSELECT 2\n  go -- next\nSELECT 3')).toEqual([
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
  });
  it('keeps GO inside a word and drops empty batches', () => {
    expect(splitBatches('SELECT gone FROM t\nGO\n\nGO\n')).toEqual(['SELECT gone FROM t']);
  });
});

describe('placeholders', () => {
  it('finds names outside quotes and comments only', () => {
    expect(
      placeholderNames(
        "SELECT {{params.email}} -- {{ignored}}\n, '{{x}}' /* {{y}} */, {{run.tag}}",
      ),
    ).toEqual(['params.email', 'run.tag']);
  });
  it('refuses a placeholder inside a string, where it would be text, not a value', () => {
    expect(placeholderProblems("SELECT * FROM t WHERE name = '{{params.email}}'")[0]).toMatch(
      /quote/i,
    );
  });
  it('refuses a placeholder where a table or column name goes', () => {
    expect(placeholderProblems('SELECT * FROM {{params.table}}')).not.toEqual([]);
    expect(placeholderProblems('SELECT a.{{params.col}} FROM a')).not.toEqual([]);
    expect(placeholderProblems('EXEC {{params.proc}}')).not.toEqual([]);
  });
  it('accepts placeholders as values', () => {
    expect(
      placeholderProblems('INSERT INTO t (a, b) VALUES ({{params.email}}, {{$randomInt(1,9)}})'),
    ).toEqual([]);
  });
});

describe('bindSql', () => {
  const sql =
    'SELECT * FROM users WHERE email = {{params.email}} OR alt = {{ params.email }} LIMIT {{params.n}}';

  it('postgres: $n, one per name', () => {
    expect(bindSql('postgres', sql, resolve)).toEqual({
      text: 'SELECT * FROM users WHERE email = $1 OR alt = $1 LIMIT $2',
      values: ['ann@shop.test', 3],
      names: ['wfm0', 'wfm1'],
    });
  });
  it('mysql: ?, one value per occurrence', () => {
    const bound = bindSql('mysql', sql, resolve);
    expect(bound).toMatchObject({
      text: 'SELECT * FROM users WHERE email = ? OR alt = ? LIMIT ?',
      values: ['ann@shop.test', 'ann@shop.test', 3],
    });
  });
  it('sqlserver: @wfmN, names aligned with values', () => {
    expect(bindSql('sqlserver', sql, resolve)).toEqual({
      text: 'SELECT * FROM users WHERE email = @wfm0 OR alt = @wfm0 LIMIT @wfm1',
      values: ['ann@shop.test', 3],
      names: ['wfm0', 'wfm1'],
    });
  });
  it('leaves comments alone and refuses placeholders in quoted text or dollar bodies', () => {
    expect(bindSql('postgres', 'SELECT 1 -- {{c}}\n, {{run.tag}}', resolve)).toMatchObject({
      text: 'SELECT 1 -- {{c}}\n, $1',
      values: ['r1'],
    });
    const quoted = bindSql('postgres', "SELECT '{{a}}', $body$ {{d}} $body$", resolve);
    expect('problems' in quoted && quoted.problems).toHaveLength(2);
  });
  it('reports what has no value', () => {
    expect(bindSql('postgres', 'SELECT {{nope}}, {{run.tag}}', resolve)).toEqual({
      missing: ['nope'],
    });
  });
  it('a value carrying SQL stays a value', () => {
    const evil = "x'); DROP TABLE users; --";
    const bound = bindSql('postgres', 'SELECT {{v}}', (n) => (n === 'v' ? evil : undefined));
    expect(bound).toEqual({ text: 'SELECT $1', values: [evil], names: ['wfm0'] });
  });
});
