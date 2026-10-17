import path from 'path';
import { createRequire } from 'module';
import type { Plugin } from 'vite';

/**
 * Monaco does not import the dompurify package it declares: domSanitize.js imports its own copy,
 * vs/base/browser/dompurify/dompurify.js, and 0.57.0 ships 3.4.15 (GHSA-p98j-92pf-mc4p,
 * GHSA-6688-9rhm-gjv2). No Monaco release carries the fix, so the build points that import at the
 * dompurify the client installs. Both expose the same default export; docs/SECURITY-AUDIT.md
 * records the swap and server/tests/dependency-locks.test.ts the version it must resolve to.
 */
export const MONACO_SANITIZER =
  /monaco-editor[\\/]esm[\\/]vs[\\/]base[\\/]browser[\\/]domSanitize\.js$/;
export const VENDORED_IMPORT = './dompurify/dompurify.js';

// The package exports only its entry points, so the ES build is found beside the CommonJS one.
const dompurify = path.join(
  path.dirname(createRequire(path.join(__dirname, 'package.json')).resolve('dompurify')),
  'purify.es.mjs',
);

const replaces = (source: string, importer: string | undefined) =>
  source === VENDORED_IMPORT && !!importer && MONACO_SANITIZER.test(importer);

export function monacoDompurify(): Plugin {
  let sanitizerSeen = false;
  let swapped = false;
  return {
    name: 'wfm:monaco-dompurify',
    enforce: 'pre',
    // The dev server pre-bundles monaco-editor with esbuild, where Rollup hooks do not run.
    config: () => ({
      optimizeDeps: {
        esbuildOptions: {
          plugins: [
            {
              name: 'wfm:monaco-dompurify',
              setup(build) {
                build.onResolve({ filter: /dompurify\.js$/ }, (args) =>
                  replaces(args.path, args.importer) ? { path: dompurify } : undefined,
                );
              },
            },
          ],
        },
      },
    }),
    buildStart() {
      sanitizerSeen = false;
      swapped = false;
    },
    resolveId(source, importer) {
      if (importer && MONACO_SANITIZER.test(importer)) sanitizerSeen = true;
      if (!replaces(source, importer)) return null;
      swapped = true;
      return dompurify;
    },
    buildEnd(error) {
      // Monaco moved or renamed its copy: building on would ship the vendored one again.
      if (!error && sanitizerSeen && !swapped) {
        this.error(`monaco-editor's domSanitize.js no longer imports ${VENDORED_IMPORT}`);
      }
    },
  };
}
