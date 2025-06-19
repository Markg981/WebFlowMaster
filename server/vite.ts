import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import winston from 'winston'; // Import winston type

// Get the file path of the current module once at module load time.
const currentModuleFilePath = fileURLToPath(import.meta.url);

const viteLogger = createLogger();

export function log(loggerInstance: winston.Logger, message: string, source = "express") {
  // The original function included a timestamp, but our Winston logger automatically adds one.
  // We'll include the 'source' in the message.
  loggerInstance.info(`[${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // Derive __dirname from the module-level file path
      const __dirname_setup = dirname(currentModuleFilePath);
      const clientTemplate = path.resolve(
        __dirname_setup, // Use __dirname derived from module-level constant
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Derive __dirname from the module-level file path
  const __dirname_static = dirname(currentModuleFilePath);
  // Assuming 'public' should be at the project root
  const distPath = path.resolve(__dirname_static, "..", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    // For consistency, resolve distPath again or use it directly
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
