/**
 * The SQL of a data fixture, made safe to run with values in it.
 *
 * A fixture's script says `WHERE Code = {{params.customerCode}}`. Splicing the value into the
 * text would make every variable an injection point: a customer code with a quote in it would
 * end the string, and one written by an attacker would run its own statement. So no value is
 * ever written into the text. Each placeholder becomes a parameter of the driver (`$1` for
 * Postgres, `?` for MySQL, `@wfm0` for SQL Server) and its value travels apart from the SQL.
 *
 * A parameter can only stand where a value stands. A placeholder inside quotes would become
 * the literal text "$1", and one naming a table or a column cannot be bound at all, so both are
 * refused when the fixture is saved (placeholderProblems), not discovered halfway through a run.
 *
 * SQL Server scripts are often written in batches separated by `GO` lines, which is a client
 * convention and not SQL. splitBatches cuts them the same way SSMS and sqlcmd do, and the other
 * dialects accept the same separator, which also lets a script run several parameterised
 * statements: Postgres and MySQL take one parameterised statement per call.
 */

/** The dialects a fixture can be written in, as server/runtime/database-step.ts names them. */
export type SqlDialect = 'postgres' | 'mysql' | 'sqlserver';

/** A placeholder as written: {{name}}, {{ params.x }}, {{$uuid}}, {{$randomInt(1,9)}}. */
const PLACEHOLDER = /\{\{\s*(\$?[\w.]+(?:\([^)]*\))?)\s*\}\}/y;

/** The keywords after which a word names a table, a database or a procedure, never a value. */
const IDENTIFIER_KEYWORDS = new Set([
  'FROM',
  'JOIN',
  'INTO',
  'UPDATE',
  'TABLE',
  'EXEC',
  'EXECUTE',
  'USE',
  'DATABASE',
  'AS',
  'CALL',
  'PROCEDURE',
  'FUNCTION',
  'VIEW',
  'INDEX',
]);

/** The batches of a script: separated by lines holding only GO (any case, optional comment). */
export function splitBatches(script: string): string[] {
  return script
    .split(/^[ \t]*GO[ \t]*(?:--[^\n]*)?$/im)
    .map((batch) => batch.trim())
    .filter((batch) => batch !== '');
}

type Visit =
  | { kind: 'text'; text: string }
  | { kind: 'placeholder'; name: string; raw: string; previousWord: string; adjacentDot: boolean }
  | { kind: 'quoted'; text: string; placeholders: string[] };

/**
 * Walks the SQL the way a parser would see it: string literals, quoted identifiers and comments
 * apart from the code, so a placeholder can be told from text that only looks like one.
 */
function scan(sql: string): Visit[] {
  const out: Visit[] = [];
  let text = '';
  let i = 0;
  let previousWord = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  const quotedUntil = (start: number, close: string, doubled: boolean): number => {
    let j = start + 1;
    while (j < sql.length) {
      if (sql.startsWith(close, j)) {
        if (doubled && sql.startsWith(close, j + close.length)) {
          j += close.length * 2;
          continue;
        }
        return j + close.length;
      }
      j++;
    }
    return sql.length;
  };
  const placeholdersIn = (chunk: string) =>
    [...chunk.matchAll(/\{\{\s*(\$?[\w.]+(?:\([^)]*\))?)\s*\}\}/g)].map((m) => m[1]);

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    let end = -1;
    if (ch === "'") end = quotedUntil(i, "'", true);
    else if (ch === '"') end = quotedUntil(i, '"', true);
    else if (ch === '`') end = quotedUntil(i, '`', true);
    else if (ch === '[') end = quotedUntil(i, ']', true);
    else if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      end = nl === -1 ? sql.length : nl;
    } else if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      end = close === -1 ? sql.length : close + 2;
    } else if (ch === '$') {
      // A Postgres dollar-quoted body: $$ … $$ or $tag$ … $tag$.
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        end = close === -1 ? sql.length : close + tag[0].length;
      }
    }
    if (end !== -1) {
      flush();
      const chunk = sql.slice(i, end);
      const isComment = chunk.startsWith('--') || chunk.startsWith('/*');
      // A comment keeps whatever it says; a literal or a quoted name cannot hold a parameter.
      if (isComment) out.push({ kind: 'text', text: chunk });
      else out.push({ kind: 'quoted', text: chunk, placeholders: placeholdersIn(chunk) });
      i = end;
      continue;
    }
    if (ch === '{' && next === '{') {
      PLACEHOLDER.lastIndex = i;
      const match = PLACEHOLDER.exec(sql);
      if (match) {
        const before = text.trimEnd();
        const after = sql.slice(i + match[0].length);
        flush();
        out.push({
          kind: 'placeholder',
          name: match[1],
          raw: match[0],
          previousWord,
          adjacentDot: before.endsWith('.') || after.startsWith('.'),
        });
        previousWord = '';
        i += match[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][\w]*/.exec(sql.slice(i))![0];
      previousWord = word.toUpperCase();
      text += word;
      i += word.length;
      continue;
    }
    if (!/\s/.test(ch)) previousWord = '';
    text += ch;
    i++;
  }
  flush();
  return out;
}

/**
 * What would stop a script from being bound, as messages for the person who wrote it. Checked
 * when a fixture is saved; the runner checks again and refuses to run a script that fails here.
 */
export function placeholderProblems(sql: string): string[] {
  const problems: string[] = [];
  for (const visit of scan(sql)) {
    if (visit.kind === 'quoted') {
      for (const name of visit.placeholders)
        problems.push(
          `{{${name}}} is inside quotes or brackets (${truncate(visit.text)}). Write it without them: the value is sent as a parameter, already typed as text.`,
        );
    } else if (visit.kind === 'placeholder') {
      if (visit.adjacentDot || IDENTIFIER_KEYWORDS.has(visit.previousWord))
        problems.push(
          `{{${visit.name}}} stands where a table, column or object name goes${visit.previousWord ? ` (after ${visit.previousWord})` : ''}. Only values can be parameters: write the name in the script.`,
        );
    }
  }
  return problems;
}

/** The placeholder names a script uses, each once, in order of appearance. */
export function placeholderNames(sql: string): string[] {
  const names: string[] = [];
  for (const visit of scan(sql))
    if (visit.kind === 'placeholder' && !names.includes(visit.name)) names.push(visit.name);
  return names;
}

export interface BoundSql {
  text: string;
  values: unknown[];
  /** For SQL Server: the parameter names, aligned with `values`. */
  names: string[];
}

/**
 * The batch with each placeholder replaced by the dialect's parameter, and the values in order.
 * `resolve` answers a placeholder name with its value, or undefined when it has none; every name
 * without a value is listed in `missing` and nothing is bound.
 */
export function bindSql(
  kind: SqlDialect,
  sql: string,
  resolve: (name: string) => unknown,
): BoundSql | { missing: string[] } | { problems: string[] } {
  const problems = placeholderProblems(sql);
  if (problems.length) return { problems };
  const visits = scan(sql);
  const missing: string[] = [];
  const index = new Map<string, number>();
  const values: unknown[] = [];
  const names: string[] = [];
  let text = '';
  for (const visit of visits) {
    if (visit.kind !== 'placeholder') {
      text += visit.text;
      continue;
    }
    const value = resolve(visit.name);
    if (value === undefined) {
      if (!missing.includes(visit.name)) missing.push(visit.name);
      continue;
    }
    if (kind === 'mysql') {
      // MySQL's `?` is positional: one value per occurrence.
      values.push(value);
      names.push(visit.name);
      text += '?';
      continue;
    }
    let position = index.get(visit.name);
    if (position === undefined) {
      position = values.length;
      index.set(visit.name, position);
      values.push(value);
      names.push(`wfm${position}`);
    }
    text += kind === 'postgres' ? `$${position + 1}` : `@wfm${position}`;
  }
  if (missing.length) return { missing };
  return { text, values, names };
}

function truncate(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}
