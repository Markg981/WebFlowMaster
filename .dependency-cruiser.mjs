/**
 * Import rules for server/ and shared/, checked by `npm run deps:check` (CI, lint job).
 *
 * The domain rules come from scripts/server-domains.mjs: a module may import its own domain and
 * domains of a lower rank, never a peer or a higher one. Imports that already broke a rule are in
 * .dependency-cruiser-known-violations.json (`npm run deps:baseline` rewrites it); fix one and
 * regenerate the file so the list only shrinks. Type-only imports count: they couple the domains
 * just the same.
 */
import { SERVER_DOMAINS } from './scripts/server-domains.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (m) => `${escape(m)}\\.ts$`;
const entry = (m) => (m.endsWith('/*') ? escape(m.slice(0, -1)) : exact(m));
// An empty list has to match nothing: `^server/()` matches every module, and as a pathNot it
// once exempted every import from the domain rules without anyone noticing.
const anyOf = (entries) => (entries.length ? `^server/(${entries.join('|')})` : '$never^');

const exactEntries = (domains) =>
  domains.flatMap((d) => d.modules.filter((m) => !m.endsWith('/*')).map(exact));

const domainRules = SERVER_DOMAINS.filter((own) =>
  SERVER_DOMAINS.some((d) => d !== own && d.rank >= own.rank),
).map((own) => {
  const others = SERVER_DOMAINS.filter((d) => d !== own);
  const forbidden = others.filter((d) => d.rank >= own.rank);
  const allowed = SERVER_DOMAINS.filter((d) => d === own || d.rank < own.rank);
  return {
    name: `domain-${own.name}`,
    comment:
      `${own.name} (rank ${own.rank}) may import only lower-ranked domains. ` +
      'See scripts/server-domains.mjs; move the code down a domain or invert the dependency.',
    severity: 'error',
    from: {
      path: anyOf(own.modules.map(entry)),
      // An exact entry of another domain inside one of this domain's directories is not ours.
      pathNot: anyOf(exactEntries(others)),
    },
    to: {
      path: anyOf(forbidden.flatMap((d) => d.modules.map(entry))),
      pathNot: anyOf(exactEntries(allowed)),
    },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    ...domainRules,
    {
      name: 'no-circular',
      comment: 'An import cycle makes load order matter and the modules impossible to test alone.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-stays-shared',
      comment: 'shared/ is read by both the server and the client, so it imports neither.',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(server|client)/' },
    },
    {
      name: 'server-not-to-client',
      comment: 'The server does not import client code; put what both need in shared/.',
      severity: 'error',
      from: { path: '^server/' },
      to: { path: '^client/' },
    },
  ],
  options: {
    exclude: { path: ['\\.test\\.ts$', '^server/tests/', 'node_modules'] },
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
