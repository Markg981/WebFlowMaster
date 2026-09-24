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

/**
 * What is handed out: the pipeline CLI, and the local agent (server/agents/relay.ts), which needs
 * the playwright and ws packages next to it and so imports them rather than bundling them.
 */
const PROGRAMS = {
  "wfm.mjs": { source: "wfm-cli.ts", built: "wfm.js", build: "build:cli" },
  "wfm-agent.mjs": { source: "wfm-agent.ts", built: "wfm-agent.js", build: "build:agent" },
} as const;

const cached = new Map<string, string>();

async function programSource(name: keyof typeof PROGRAMS): Promise<string> {
  const program = PROGRAMS[name];
  // `npm run build` writes them; the Docker images run that.
  if (process.env.NODE_ENV === "production") {
    if (!cached.has(name)) cached.set(name, await fs.readFile(path.resolve(process.cwd(), "dist", program.built), "utf8"));
    return cached.get(name)!;
  }
  // Elsewhere, bundled from the source on every request: a dist/ left over from an old build
  // would hand out a program that no longer matches the server.
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), "scripts", program.source)],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
  });
  return result.outputFiles[0].text;
}

router.get("/cli/:program", async (req, res, next) => {
  const name = req.params.program;
  if (!(name in PROGRAMS)) return next();
  try {
    const source = await programSource(name as keyof typeof PROGRAMS);
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    // Short: a pipeline or an agent should get the program of the server it talks to, after an upgrade too.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(source);
  } catch (error: any) {
    logger.error({ message: "A program could not be served", program: name, error: error?.message });
    res.status(503).type("text/plain").send(`${name} is not available on this server: run \`npm run ${PROGRAMS[name as keyof typeof PROGRAMS].build}\`.\n`);
  }
});

export default router;
