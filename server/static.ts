import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

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
export const CLIENT_BUILD_DIRNAME = "public";

const currentModuleFilePath = fileURLToPath(import.meta.url);

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
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
