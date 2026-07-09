import type { Request, Response, NextFunction } from "express";

// CSRF defense via Origin/Referer validation (OWASP-recommended for cookie-auth APIs),
// layered on top of the SameSite=Lax session cookie.
//
// - Safe methods (GET/HEAD/OPTIONS) are never checked.
// - State-changing requests must carry an Origin (or Referer) whose host matches this
//   app's own host. A cross-site page's request carries ITS origin -> mismatch -> 403.
// - Requests with no Origin/Referer are server-to-server (curl, CI/CD webhooks), which
//   are not a CSRF vector, so they pass. This is what keeps the token-authed
//   /api/webhooks endpoints callable by external automation.
//
// Behind a proxy the public host may differ from the internal Host header; set
// CSRF_TRUSTED_ORIGINS (comma-separated origins) to allowlist it explicitly.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(urlOrHost: string | undefined): string | null {
  if (!urlOrHost) return null;
  try {
    return new URL(urlOrHost).host;
  } catch {
    return null;
  }
}

function trustedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  if (req.headers.host) hosts.add(req.headers.host);
  const xfHost = req.headers["x-forwarded-host"];
  if (typeof xfHost === "string") xfHost.split(",").forEach((h) => hosts.add(h.trim()));
  const env = process.env.CSRF_TRUSTED_ORIGINS;
  if (env) {
    env.split(",").forEach((o) => {
      const h = hostOf(o.trim());
      if (h) hosts.add(h);
    });
  }
  return hosts;
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const originHost = hostOf(req.headers.origin) ?? hostOf(req.headers.referer);
  // No browser-supplied origin -> server-to-server client, not a CSRF vector.
  if (!originHost) return next();

  if (trustedHosts(req).has(originHost)) return next();

  res.status(403).json({ error: "CSRF validation failed: cross-origin request rejected." });
}
