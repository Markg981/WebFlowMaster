// Static foreign-key index audit: parses the hand-written SQL migrations (no database needed) and
// lists the foreign keys whose columns are not the leading columns of any index, primary key or
// unique constraint. Heuristic: it does not see indexes created outside migrations/.

const unq = (s) =>
  s
    .trim()
    .replace(/^"?public"?\./, '')
    .replace(/"/g, '');

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTop(text, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const cols = (list) => splitTop(list).map((c) => unq(c.split(/\s+/)[0]));
const IDENT = String.raw`(?:"[^"]+"|[\w.]+)`;

/** Parses the SQL of many migrations (in order) into { tables, fks, indexes }. */
export function parseMigrations(files) {
  const fks = []; // { table, cols, refTable, onDelete, file }
  const indexes = new Map(); // key -> { table, cols, kind, name }
  const addIdx = (table, c, kind, name) =>
    indexes.set(`${table}:${name}`, { table, cols: c, kind, name });
  const dropTable = (t) => {
    for (let i = fks.length - 1; i >= 0; i--) if (fks[i].table === t) fks.splice(i, 1);
    for (const [k, v] of indexes) if (v.table === t) indexes.delete(k);
  };

  const handleItem = (table, item, file) => {
    let m;
    const body = item
      .replace(/^\s*ADD\s+(?=CONSTRAINT|FOREIGN|PRIMARY|UNIQUE)/i, '')
      .replace(/^\s*CONSTRAINT\s+\S+\s+/i, '');
    if ((m = body.match(/^FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\S+?)\s*(?:\(|\s|$)(.*)$/is))) {
      fks.push({
        table,
        cols: cols(m[1]),
        refTable: unq(m[2]),
        onDelete:
          (m[3].match(/ON DELETE\s+(cascade|set null|restrict|no action|set default)/i) ||
            [])[1]?.toLowerCase() ?? 'no action',
        file,
      });
    } else if ((m = body.match(/^PRIMARY KEY\s*\(([^)]+)\)/i))) {
      addIdx(table, cols(m[1]), 'primary', `${table}_pkey`);
    } else if ((m = body.match(/^UNIQUE\s*\(([^)]+)\)/i))) {
      addIdx(table, cols(m[1]), 'unique', `${table}_${cols(m[1]).join('_')}_key`);
    } else if (
      (m = body.match(
        new RegExp(
          String.raw`^(?:ADD\s+)?(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?(${IDENT})\s+(.*)$`,
          'is',
        ),
      ))
    ) {
      const col = unq(m[1]);
      const rest = m[2];
      if (/^(KEY|CHECK|EXCLUDE|LIKE)$/i.test(col)) return;
      const r = rest.match(/REFERENCES\s+(\S+?)\s*(?:\(|\s|$)(.*)$/is);
      if (r)
        fks.push({
          table,
          cols: [col],
          refTable: unq(r[1]),
          onDelete:
            (r[2].match(/ON DELETE\s+(cascade|set null|restrict|no action|set default)/i) ||
              [])[1]?.toLowerCase() ?? 'no action',
          file,
        });
      if (/\bPRIMARY KEY\b/i.test(rest)) addIdx(table, [col], 'primary', `${table}_pkey`);
      else if (/\bUNIQUE\b/i.test(rest)) addIdx(table, [col], 'unique', `${table}_${col}_key`);
    }
  };

  for (const { name: file, sql: raw } of files) {
    for (const stmt of splitTop(stripComments(raw), ';')) {
      let m;
      if (
        (m = stmt.match(
          new RegExp(
            String.raw`^CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?(${IDENT})\s*\(([\s\S]*)\)\s*$`,
            'i',
          ),
        ))
      ) {
        const table = unq(m[1]);
        for (const item of splitTop(m[2])) handleItem(table, item, file);
      } else if (
        (m = stmt.match(
          new RegExp(
            String.raw`^ALTER\s+TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s+([\s\S]*)$`,
            'i',
          ),
        ))
      ) {
        const table = unq(m[1]);
        for (const clause of splitTop(m[2])) {
          const d = clause.match(
            new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF EXISTS\s+)?(${IDENT})`, 'i'),
          );
          if (d && !/^DROP\s+CONSTRAINT/i.test(clause)) {
            const c = unq(d[1]);
            for (let i = fks.length - 1; i >= 0; i--)
              if (fks[i].table === table && fks[i].cols.includes(c)) fks.splice(i, 1);
          } else if (/^ADD\s+/i.test(clause))
            handleItem(table, clause.replace(/^ADD\s+/i, 'ADD '), file);
        }
      } else if (
        (m = stmt.match(
          new RegExp(
            String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?(${IDENT})\s+ON\s+(?:ONLY\s+)?(${IDENT})\s*(?:USING\s+\w+\s*)?\(([\s\S]*)\)`,
            'i',
          ),
        ))
      ) {
        const list = splitTop(m[4]).map((c) => c.trim());
        // expression indexes (functions) do not serve plain FK lookups: stop at the first one
        const plain = [];
        for (const c of list) {
          if (/^"?[\w]+"?(\s+(ASC|DESC|NULLS\s+(FIRST|LAST)))*$/i.test(c))
            plain.push(unq(c.split(/\s+/)[0]));
          else break;
        }
        addIdx(unq(m[3]), plain, m[1] ? 'unique' : 'index', unq(m[2]));
      } else if (
        (m = stmt.match(
          new RegExp(
            String.raw`^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?(${IDENT})`,
            'i',
          ),
        ))
      ) {
        const n = unq(m[1]);
        for (const [k, v] of indexes) if (v.name === n) indexes.delete(k);
      } else if (
        (m = stmt.match(new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF EXISTS\s+)?(${IDENT})`, 'i')))
      ) {
        dropTable(unq(m[1]));
      }
    }
  }
  return { fks, indexes: [...indexes.values()] };
}

/**
 * FKs whose first column is not the leading column of any index on the same table. For a composite
 * FK (col, organization_id) an index led by col is enough to find the child rows of a parent row.
 */
export function findUnindexed({ fks, indexes }) {
  const seen = new Set();
  const out = [];
  for (const fk of fks) {
    const key = `${fk.table}:${fk.cols.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const covered = indexes.some((ix) => ix.table === fk.table && ix.cols[0] === fk.cols[0]);
    if (!covered) out.push(fk);
  }
  return out;
}
