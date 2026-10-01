import { z } from "zod";

/**
 * Shared test data: named tables of values an organization keeps once and every test reuses.
 *
 * A test's own dataset belonged to that test alone, and an environment holds settings and
 * secrets, not data; so the same customers, products or cards were copied into test after test,
 * and drifted. A shared set is used two ways:
 *
 * - **Values.** `{{data.<set>.<column>}}` resolves, in any UI, API or mobile test, to the column's
 *   value in the set's first row — a known customer, a product code.
 * - **Rows.** A UI test can take a shared set as its dataset and run once per row. The test keeps a
 *   marker, `[{ "$sharedSet": "<id>" }]`, in its own dataset field, so versions and publishing carry
 *   the link unchanged; the marker is expanded into the set's rows just before the test runs.
 */

export const TEST_DATA_LIMITS = { rows: 1000, columns: 50, value: 10_000 } as const;

/** A set's name, as it appears in `{{data.<name>.<column>}}`. */
export const DATA_SET_NAME = /^[a-z][a-z0-9_]{0,49}$/;
/** A column, as a placeholder can name it: `{{…}}` takes letters, digits and underscores. */
export const DATA_COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

export const DATA_PREFIX = "data";
export const SHARED_SET_MARKER = "$sharedSet";

export const testDataSetInputSchema = z
  .object({
    name: z.string().trim().regex(DATA_SET_NAME, "A name is lowercase letters, digits and underscores, starting with a letter (customers, eu_cards)."),
    description: z.string().trim().max(500).optional().nullable(),
    columns: z
      .array(z.string().trim().regex(DATA_COLUMN, "A column is letters, digits and underscores, starting with a letter or underscore."))
      .min(1, "A data set needs at least one column.")
      .max(TEST_DATA_LIMITS.columns)
      .refine((columns) => new Set(columns).size === columns.length, "Two columns have the same name."),
    rows: z.array(z.record(z.string().max(TEST_DATA_LIMITS.value))).min(1, "A data set needs at least one row.").max(TEST_DATA_LIMITS.rows),
  })
  .strict()
  .superRefine((value, ctx) => {
    const known = new Set(value.columns);
    value.rows.forEach((row, index) => {
      const unknown = Object.keys(row).find((key) => !known.has(key));
      if (unknown) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", index], message: `Row ${index + 1} has a value for "${unknown}", which is not a column.` });
    });
  });

export type TestDataSetInput = z.infer<typeof testDataSetInputSchema>;

/** The `{{data.<set>.<column>}}` values of the given sets: each column's value in the first row. */
export function dataVariables(sets: Array<{ name: string; columns: string[]; rows: Array<Record<string, string>> }>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const set of sets) {
    const first = set.rows[0] ?? {};
    for (const column of set.columns) vars[`${DATA_PREFIX}.${set.name}.${column}`] = first[column] ?? "";
  }
  return vars;
}

/** The shared set a test's dataset points at, or null when it holds its own rows (or none). */
export function sharedSetIdOf(dataset: unknown): number | null {
  const parsed = typeof dataset === "string" ? (() => { try { return JSON.parse(dataset); } catch { return null; } })() : dataset;
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  const row = parsed[0];
  if (!row || typeof row !== "object" || Object.keys(row).length !== 1) return null;
  const id = Number((row as Record<string, unknown>)[SHARED_SET_MARKER]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The dataset value a test stores to use a shared set. */
export function sharedSetMarker(id: number): Array<Record<string, string>> {
  return [{ [SHARED_SET_MARKER]: String(id) }];
}
