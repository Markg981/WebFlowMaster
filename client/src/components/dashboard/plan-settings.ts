/**
 * What the plan wizard and the plan's settings dialog agree on.
 *
 * The wizard creates a plan and the dialog changes it afterwards; a choice offered in one and
 * not the other is a plan nobody can make the way they want without saving it twice. The
 * option lists both forms show live here, so neither can drift from the other.
 */

/** The three answers to "keep a recording?", in the order they escalate. */
export const EVIDENCE_MODES = [
  { value: 'never', label: 'Never' },
  { value: 'on_failure', label: 'When the test fails' },
  { value: 'always', label: 'Always' },
] as const;

/** How many of a plan's tests may run at once: the server accepts 1 to 16. */
export const MAX_PARALLEL_TESTS = 16;

/** The Select cannot hold an empty value, and "no device" (the desktop) is a real choice. */
export const DESKTOP = 'desktop';
