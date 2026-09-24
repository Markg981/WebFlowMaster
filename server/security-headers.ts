import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * HTTP security headers, and the Content Security Policy in particular.
 *
 * Helmet's other headers were already on; the CSP was switched off because the Vite dev server
 * injects inline scripts. That left the production client with no policy at all, while it loaded a
 * script from replit.com on every page and the code editor from a CDN (both removed). The policy
 * below says what the built client actually needs: its own scripts and workers, inline styles
 * (React and Radix set style attributes), Google Fonts, and images, videos and connections to this
 * origin — the WebSocket for live logs included, which 'self' covers.
 *
 * CONTENT_SECURITY_POLICY decides whether it is sent:
 *   enforce      — the default in production;
 *   report-only  — sent as Content-Security-Policy-Report-Only, so a browser console shows what
 *                  would be blocked without blocking it: for trying a change out;
 *   off          — the default elsewhere, since the dev server needs inline scripts.
 */
export type CspMode = 'enforce' | 'report-only' | 'off';

export function cspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  const raw = env.CONTENT_SECURITY_POLICY?.trim().toLowerCase();
  if (!raw) return env.NODE_ENV === 'production' ? 'enforce' : 'off';
  if (raw === 'enforce' || raw === 'report-only' || raw === 'off') return raw;
  throw new Error(`CONTENT_SECURITY_POLICY must be "enforce", "report-only" or "off"; got "${env.CONTENT_SECURITY_POLICY}".`);
}

export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  // The code editor's language services run in workers the client bundle ships.
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
};

export function securityHeaders(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const mode = cspMode(env);
  return helmet({
    contentSecurityPolicy:
      mode === 'off'
        ? false
        : {
            useDefaults: false,
            directives: CSP_DIRECTIVES,
            reportOnly: mode === 'report-only',
          },
  });
}
