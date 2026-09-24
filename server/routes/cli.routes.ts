import { Router } from "express";
import path from "path";
import fs from "fs-extra";
import loggerPromise from "../logger";

/**
 * GET /cli/wfm.mjs — the pipeline CLI, as this server's build of it.
 *
 * The README told pipelines to run `npx wfm`, and there is no such package: nothing was ever
 * published, so the one documented way to use the CLI from a pipeline did not work. Publishing it
 * to npm would make its version and the server's drift apart. Instead, the server hands out the
 * CLI it was built with. A pipeline fetches it from the server it is about to talk to, and runs it
 * with the Node every CI image already has:
 *
 *   curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs && node wfm.mjs run <planId> --wait
 *
 * Public, like /api/v1/openapi.json: it is the same code for everyone and does nothing without
 * a key.
 */

const router = Router();
const logger = await loggerPromise;

let cached: string | null = null;

async function cliSource(): Promise<string> {
  if (cached !== null) return cached;
  // `npm run build` writes it (build:cli); the Docker images run that.
  if (process.env.NODE_ENV === "production") {
    cached = await fs.readFile(path.resolve(process.cwd(), "dist", "wfm.js"), "utf8");
    return cached;
  }
  // Elsewhere, bundled from the source on every request: a dist/ left over from an old build
  // would hand out a CLI that no longer matches the server.
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), "scripts", "wfm-cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
  });
  return result.outputFiles[0].text;
}

router.get("/cli/wfm.mjs", async (_req, res) => {
  try {
    const source = await cliSource();
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="wfm.mjs"');
    // Short: a pipeline should get the CLI of the server it is talking to, after an upgrade too.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(source);
  } catch (error: any) {
    logger.error({ message: "The CLI could not be served", error: error?.message });
    res.status(503).type("text/plain").send("The CLI is not available on this server: run `npm run build:cli`.\n");
  }
});

export default router;
