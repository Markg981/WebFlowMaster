import type { IncomingHttpHeaders } from 'http';
import type { Request, Response, NextFunction } from 'express';
import { trustProxySetting } from '../../platform/trust-proxy';

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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The SAML assertion consumer service: the identity provider's page POSTs the signed response from its
// own origin, by design. What protects it is the response's signature, the request it must answer and
// the browser binding (server/identity/sso-saml.ts), not the origin.
const CROSS_SITE_BY_DESIGN = /^\/api\/sso\/saml\/\d+\/(acs|slo)$/;

function hostOf(urlOrHost: string | undefined): string | null {
  if (!urlOrHost) return null;
  try {
    return new URL(urlOrHost).host;
  } catch {
    return null;
  }
}

function trustedHosts(req: { headers: IncomingHttpHeaders }): Set<string> {
  const hosts = new Set<string>();
  if (req.headers.host) hosts.add(req.headers.host);
  // X-Forwarded-Host is the proxy's word: honoured only where a proxy is trusted (TRUST_PROXY).
  const proxy = trustProxySetting();
  const xfHost = req.headers['x-forwarded-host'];
  if (typeof xfHost === 'string' && proxy !== false && proxy !== 0)
    xfHost.split(',').forEach((h) => hosts.add(h.trim()));
  const env = process.env.CSRF_TRUSTED_ORIGINS;
  if (env) {
    env.split(',').forEach((o) => {
      const h = hostOf(o.trim());
      if (h) hosts.add(h);
    });
  }
  return hosts;
}

/**
 * Whether a browser-supplied Origin names this app (the request's own host, the forwarded host or
 * CSRF_TRUSTED_ORIGINS). No Origin means a non-browser client: it passes, as in csrfOriginCheck.
 * Used by the WebSocket upgrade, which does not go through Express (audit C-26).
 */
export function isTrustedOrigin(req: { headers: IncomingHttpHeaders }): boolean {
  const originHost = hostOf(req.headers.origin);
  if (!originHost) return !req.headers.origin;
  return trustedHosts(req).has(originHost);
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.method === 'POST' && CROSS_SITE_BY_DESIGN.test(req.path)) return next();

  // `Origin: null` is what a sandboxed iframe or a cross-origin redirect sends: a browser, and not
  // a page of ours, so it is refused rather than treated as "no origin" (audit C-38 ID-10).
  if (req.headers.origin === 'null') {
    res.status(403).json({ error: 'CSRF validation failed: cross-origin request rejected.' });
    return;
  }
  const originHost = hostOf(req.headers.origin) ?? hostOf(req.headers.referer);
  // No browser-supplied origin -> server-to-server client, not a CSRF vector.
  if (!originHost) return next();

  if (trustedHosts(req).has(originHost)) return next();

  res.status(403).json({ error: 'CSRF validation failed: cross-origin request rejected.' });
}
