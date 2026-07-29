import type { ClientIncidentReport, ClientLogLevel } from '@shared/observability';
import { clientLogger, setLogLevel } from './logger';
import { getSessionId, newCorrelationId } from './session';
import { pushBreadcrumb, takeBreadcrumbs } from './breadcrumbs';

const INCIDENT_URL = '/api/incidents';

let installed = false;
/**
 * Undo functions for everything `installObservability` registers. Kept because an install
 * with no uninstall leaks listeners: across Vite's HMR the module re-evaluates and would
 * stack a second set, so every click would produce two breadcrumbs.
 */
let teardown: (() => void)[] = [];

/**
 * A short, stable-ish description of what was clicked. Never captures field values —
 * a breadcrumb records that a field was touched, not what was typed into it.
 */
function describeTarget(element: Element | null): string | undefined {
  if (!element) return undefined;
  if (element.id) return `#${element.id}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  const label = element.getAttribute('aria-label');
  if (label) return `${element.tagName.toLowerCase()}[aria-label="${label}"]`;
  const text = (element.textContent ?? '').trim().slice(0, 40);
  return text ? `${element.tagName.toLowerCase()}:"${text}"` : element.tagName.toLowerCase();
}

export function reportClientIncident(input: {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  props?: Record<string, unknown>;
}): void {
  try {
    if (typeof fetch !== 'function') return;

    const report: ClientIncidentReport = {
      sessionId: getSessionId(),
      correlationId: newCorrelationId(),
      route: typeof location !== 'undefined' ? location.pathname : undefined,
      name: input.name,
      message: input.message,
      stack: input.stack,
      componentStack: input.componentStack,
      props: input.props,
      breadcrumbs: takeBreadcrumbs(),
    };

    // Logged as well, so the log file itself shows the failure rather than only the artifact.
    clientLogger.error(`${input.name}: ${input.message}`, { componentStack: input.componentStack });

    void fetch(INCIDENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'include',
      keepalive: true,
    }).catch((error) => {
      // Never through clientLogger: reporting a report failure would recurse.
      console.warn('[observability] failed to report incident', error);
    });
  } catch (error) {
    console.warn('[observability] failed to build incident report', error);
  }
}

/** Reads the configured client level; falls back silently to the compiled default. */
async function applyConfiguredLevel(): Promise<void> {
  try {
    const override = localStorage.getItem('wfm:logLevel') as ClientLogLevel | null;
    if (override) {
      setLogLevel(override);
      return;
    }
    const res = await fetch('/api/system-settings/clientLogLevel', { credentials: 'include' });
    if (!res.ok) return;
    const setting = (await res.json()) as { value?: string } | null;
    if (setting?.value) setLogLevel(setting.value as ClientLogLevel);
  } catch {
    // Keep the default; the level is a convenience, not a requirement.
  }
}

/**
 * Idempotent: safe to call from a component that may remount. A second call must not
 * double-register the listeners, or every click would produce two breadcrumbs.
 */
export function installObservability(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  try {
    const onError = (event: ErrorEvent) => {
      reportClientIncident({
        name: event.error?.name ?? 'Error',
        message: event.message,
        stack: event.error?.stack,
      });
    };

    const onRejection = (event: Event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      reportClientIncident({ name: error.name, message: error.message, stack: error.stack });
    };

    const onClick = (event: Event) => {
      pushBreadcrumb({ type: 'click', target: describeTarget(event.target as Element) });
    };

    // Field identity only — never the value.
    const onFocus = (event: Event) => {
      pushBreadcrumb({ type: 'focus', target: describeTarget(event.target as Element) });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocus, true);

    teardown = [
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('focusin', onFocus, true),
    ];

    void applyConfiguredLevel();
  } catch (error) {
    console.warn('[observability] install failed; continuing without it', error);
  }
}

/**
 * Test seam: genuinely uninstalls, rather than only clearing the guard flag. Clearing the
 * flag alone would let each test stack another set of listeners on the shared document,
 * and a later test asserting "one breadcrumb per click" would fail for the wrong reason.
 */
export function __resetInstallForTests(): void {
  for (const undo of teardown) undo();
  teardown = [];
  installed = false;
}
