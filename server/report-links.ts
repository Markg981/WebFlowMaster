/**
 * A link back to a run, for somebody reading about it somewhere else.
 *
 * One place, because there are now three senders — the webhook notification, a Jira issue, an
 * Azure DevOps work item — and a link that lands on "page not found" is worse than no link at
 * all: it costs the reader the trip before it tells them nothing.
 *
 * The path is the one the client actually serves (see client/src/App.tsx). The notification
 * used to build its own, `/test-plan-executions/{id}`, which no route has ever matched.
 *
 * `WEBFLOW_PUBLIC_URL` is deliberately not `APP_BASE_URL`: that one points at the system under
 * test, and a report link into the application being tested would be worse than none.
 */

/** Where this installation can be reached from outside, or nothing if nobody has said. */
export function publicBaseUrl(): string | undefined {
  const base = process.env.WEBFLOW_PUBLIC_URL?.trim();
  return base ? base.replace(/\/+$/, '') : undefined;
}

/**
 * The report page for one execution, when the plan is known.
 *
 * Without a plan id there is no page to link to — the report route is nested under the plan —
 * so this answers with nothing rather than with a URL that would not resolve.
 */
export function reportUrlFor(planId: string | null | undefined, executionId: string): string | undefined {
  const base = publicBaseUrl();
  const reportPath = reportPathFor(planId, executionId);
  if (!base || !reportPath) return undefined;
  return `${base}${reportPath}`;
}

/**
 * The report page's path on this installation, with or without its public address.
 *
 * What a sender still has when WEBFLOW_PUBLIC_URL is not set: a receiver that knows where the
 * installation is can complete it, where "run 1234" alone leaves them to find the page.
 */
export function reportPathFor(planId: string | null | undefined, executionId: string): string | undefined {
  if (!planId) return undefined;
  return `/test-plans/${encodeURIComponent(planId)}/executions/${encodeURIComponent(executionId)}/report`;
}

/** A report reference for a text: the link, else the path and the run id. */
export function reportReferenceFor(planId: string | null | undefined, executionId: string): string {
  const url = reportUrlFor(planId, executionId);
  if (url) return `Report: ${url}`;
  const path = reportPathFor(planId, executionId);
  return path ? `Report: ${path} (run ${executionId})` : `Run: ${executionId}`;
}
