/** Generate the complete bilingual structural table/column catalog without importing the DB. */
import ts from 'typescript';
import prettier from 'prettier';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The domain files, in the order the shared/schema.ts barrel exports them.
const schemaFiles = [
  ...fs
    .readFileSync(path.join(root, 'shared/schema.ts'), 'utf8')
    .matchAll(/from '\.\/(schema\/[\w-]+)'/g),
].map((match) => `shared/${match[1]}.ts`);
if (!schemaFiles.length) throw new Error('shared/schema.ts exports no shared/schema/ files.');
const tables = [];
let source;
let sourceFile;

function firstCall(node) {
  if (ts.isCallExpression(node)) {
    return ts.isPropertyAccessExpression(node.expression)
      ? firstCall(node.expression.expression)
      : node;
  }
  return undefined;
}

function clean(node) {
  return node.getText(source).replace(/\s+/g, ' ').replace(/\|/g, '&#124;').replace(/`/g, '&#96;');
}

function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const call = firstCall(node.initializer);
    if (call && ts.isIdentifier(call.expression) && call.expression.text === 'pgTable') {
      const [name, columns] = call.arguments;
      if (!ts.isStringLiteral(name) || !ts.isObjectLiteralExpression(columns)) {
        throw new Error(`Unsupported table declaration: ${node.name.getText(source)}`);
      }
      const fields = columns.properties.map((prop) => {
        if (!ts.isPropertyAssignment(prop))
          throw new Error(`Unsupported column: ${prop.getText(source)}`);
        const base = firstCall(prop.initializer);
        if (!base) throw new Error(`Missing builder: ${prop.name.getText(source)}`);
        const column = base.arguments[0];
        if (!column || !ts.isStringLiteral(column))
          throw new Error(`Missing database column name: ${prop.name.getText(source)}`);
        return {
          property: prop.name.getText(source),
          name: column.text,
          builder: clean(prop.initializer),
          line: source.getLineAndCharacterOfPosition(prop.getStart(source)).line + 1,
        };
      });
      tables.push({
        symbol: node.name.getText(source),
        file: sourceFile,
        name: name.text,
        fields,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
  }
  ts.forEachChild(node, visit);
}
for (const file of schemaFiles) {
  sourceFile = file;
  source = ts.createSourceFile(
    path.basename(file),
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  visit(source);
}
if (!tables.length)
  throw new Error('No pgTable declarations found; do not publish an empty catalog.');

// --check compares instead of writing, and fails when a committed catalog no longer matches
// shared/schema/: the page states table and column counts, and a stale one misleads.
const check = process.argv.includes('--check');
const stale = [];

for (const lang of ['en', 'it']) {
  const isIt = lang === 'it';
  const lines = [
    `# ${isIt ? 'Catalogo completo delle tabelle e colonne' : 'Complete table and column catalog'}`,
    '',
    isIt
      ? 'Generato da `shared/schema/` (un file per dominio) con `node scripts/generate-schema-catalog.mjs`. Non si connette al database. Il codice SQL delle migrazioni resta autorità per indici, vincoli, policy RLS e permessi effettivi; questo catalogo descrive le dichiarazioni Drizzle, non lo stato di un ambiente installato.'
      : 'Generated from `shared/schema/` (one file per domain) with `node scripts/generate-schema-catalog.mjs`. No database connection is made. SQL migrations remain authoritative for indexes, constraints, RLS policies and effective grants; this catalog describes Drizzle declarations, not an installed environment.',
    '',
    isIt
      ? 'Leggere prima lo [schema per dominio](./database-schema) per le spiegazioni e le relazioni, poi cercare qui la tabella. Ogni riga riporta la proprietà TypeScript, il nome SQL e il builder completo: tipo, nullabilità, default e riferimenti dichiarati nella colonna. I vincoli definiti nel callback della tabella non sono espansi qui.'
      : 'Read the [domain schema](./database-schema) for explanations and relationships, then find the table here. Each row lists the TypeScript property, SQL name and complete builder: type, nullability, default and references declared on the column. Table callback constraints are not expanded here.',
    '',
    `**${tables.length} ${isIt ? 'tabelle' : 'tables'} / ${tables.reduce((n, t) => n + t.fields.length, 0)} ${isIt ? 'colonne dichiarate' : 'declared columns'}.**`,
    '',
    isIt ? '## Indice' : '## Index',
    '',
    '| SQL | TypeScript | ' + (isIt ? 'Colonne' : 'Columns') + ' |',
    '|---|---|---|',
    ...tables.map(
      (t) =>
        `| [${t.name}](#${t.name.replaceAll('_', '-')}) | \`${t.symbol}\` | ${t.fields.length} |`,
    ),
    '',
  ];
  for (const table of tables) {
    lines.push(
      `## ${table.name} {#${table.name.replaceAll('_', '-')}}`,
      '',
      `\`${table.symbol}\` — \`${table.file}:${table.line}\``,
      '',
      `| ${isIt ? 'Proprietà TS' : 'TS property'} | ${isIt ? 'Colonna SQL' : 'SQL column'} | ${isIt ? 'Dichiarazione' : 'Declaration'} |`,
      '|---|---|---|',
      ...table.fields.map((f) => `| \`${f.property}\` | \`${f.name}\` | \`${f.builder}\` |`),
      '',
    );
  }
  const output = path.join(root, 'docs', lang, 'internals/schema-catalog.md');
  const formatOptions = (await prettier.resolveConfig(output)) ?? {};
  const content = await prettier.format(lines.join('\n'), { ...formatOptions, parser: 'markdown' });
  if (check) {
    const current = fs.existsSync(output)
      ? fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (current !== content) stale.push(path.relative(root, output));
    continue;
  }
  fs.writeFileSync(output, content);
  console.log(
    `${path.relative(root, output)}: ${tables.length} tables, ${tables.reduce((n, t) => n + t.fields.length, 0)} columns`,
  );
}

if (stale.length) {
  console.error(
    `Out of date with shared/schema/: ${stale.join(', ')}. Run npm run docs:schema-catalog.`,
  );
  process.exit(1);
}
