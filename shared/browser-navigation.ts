/**
 * The addresses a browser test may open: web pages, and `about:blank`.
 *
 * A `file://` page is the disk of the machine the browser runs on, and `view-source:file://`
 * the same disk by another name; neither is a system under test. The rule is checked twice
 * with the same function: when a test is saved (shared/schema/authoring.ts) and when the
 * runner's own browser is about to navigate (server/platform/egress-policy.ts), where a value
 * built from {{variables}} is finally known.
 */
export const BROWSER_NAVIGATION_SCHEMES = ['http:', 'https:', 'about:'] as const;

/**
 * The scheme a browser test may not open, such as `file:`, or undefined when the address is
 * a web page. Text that is not an absolute URL yet — `{{baseUrl}}/login` — is left to the run.
 */
export function forbiddenNavigationScheme(text: string | null | undefined): string | undefined {
  let url: URL;
  try {
    url = new URL((text ?? '').trim());
  } catch {
    return undefined;
  }
  return (BROWSER_NAVIGATION_SCHEMES as readonly string[]).includes(url.protocol)
    ? undefined
    : url.protocol;
}
