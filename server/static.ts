import express, { type Express, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Serving the built client, in production.
 *
 * Separate from server/vite.ts because that module imports vite, which is a dev dependency
 * that `npm prune --omit=dev` removes from the image. A static `import … from "./vite"` in
 * the entry point is evaluated when dist/index.js loads, whatever branch later decides to
 * call setupVite — so the built container died with "Cannot find package 'vite'" before
 * running a line of its own code. Splitting the two means production never reaches for it.
 */

/**
 * Where the client build lands, relative to the running server bundle.
 *
 * Named here and used by client/vite.config.ts's outDir, because the two are set in
 * different files and drifted: the server looked in `public` at the repository root while
 * vite wrote to `client/dist`. The symptom was a container that started and then answered
 * every page request with "Could not find the build directory", with the build sitting
 * happily in another folder.
 */
export const CLIENT_BUILD_DIRNAME = 'public';

const currentModuleFilePath = fileURLToPath(import.meta.url);

/** The answer to an /api path no route handles: a JSON 404, never the client's index.html. */
export function apiNotFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'No such endpoint.' });
}

/** Where the user manual is served, and where `npm run build:docs` builds it (beside the client). */
export const DOCS_PATH = '/docs';
export const DOCS_BUILD_DIRNAME = 'docs';

/**
 * The manual's own build, wherever this module runs from: dist/docs beside the bundle in the
 * image, or the repository's dist/docs under `npm run dev` (after `npm run build:docs`).
 */
export function defaultDocsDir(): string | null {
  const here = dirname(currentModuleFilePath);
  return (
    [
      path.resolve(here, DOCS_BUILD_DIRNAME),
      path.resolve(here, '..', 'dist', DOCS_BUILD_DIRNAME),
    ].find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null
  );
}

/**
 * The inline scripts every VitePress page carries (appearance, platform class, page hash map),
 * as CSP hashes. They are the same on every page of one build, so the home page is enough.
 */
export function docsScriptHashes(docsDir: string): string[] {
  const html = fs.readFileSync(path.join(docsDir, 'index.html'), 'utf8');
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
  }
  return [...hashes];
}

/**
 * The user manual at /docs/, for the contextual help links (client/src/lib/help-links.ts).
 * Shipped inside the application rather than hosted elsewhere: every installation reads the
 * manual of its own version, and air-gapped ones can read it at all.
 *
 * Mounted ahead of the client's catch-all, so a missing page is the manual's 404, not the app.
 * The application's CSP allows no inline script, which VitePress pages need; under /docs the
 * policy also allows exactly those scripts, by hash.
 */
export function serveDocs(app: Express, docsDir: string | null = defaultDocsDir()) {
  if (!docsDir) {
    app.use(DOCS_PATH, (_req, res) => {
      res
        .status(404)
        .type('text')
        .send('The user manual is not part of this build. Run `npm run build:docs` to add it.');
    });
    return;
  }

  const allowed = docsScriptHashes(docsDir).join(' ');
  app.use(DOCS_PATH, (_req, res, next) => {
    for (const header of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
      const policy = res.getHeader(header);
      if (typeof policy === 'string') {
        res.setHeader(header, policy.replace(/script-src 'self'/, `script-src 'self' ${allowed}`));
      }
    }
    next();
  });
  // cleanUrls: /docs/en/guide/results is results.html.
  app.use(DOCS_PATH, express.static(docsDir, { extensions: ['html'] }));
  app.use(DOCS_PATH, (_req, res) => {
    res.status(404).sendFile(path.join(docsDir, '404.html'));
  });
}

export function serveStatic(app: Express) {
  // In the built image this module is bundled into dist/index.js, so this resolves to
  // dist/public — the directory the client build writes into.
  const distPath = path.resolve(dirname(currentModuleFilePath), CLIENT_BUILD_DIRNAME);

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the built client at ${distPath}. Run \`npm run build\` first — it ` +
        `builds the client into that directory and then bundles the server beside it.`,
    );
  }

  app.use(express.static(distPath));

  // Anything that is not a file is a client route: hand back index.html and let the router
  // in the browser deal with it.
  app.use('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
