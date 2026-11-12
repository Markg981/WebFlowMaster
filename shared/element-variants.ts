import { z } from 'zod';

/**
 * Locator variants of a repository element: the same button where one environment's build renders
 * it differently, for instance the migrated front end a comparison judges against production.
 *
 * A run picks a variant with its `uiVariant` variable, which an environment sets like any other.
 * An element without that variant, and a run without the variable, use the element's own
 * selector, so a variant only ever changes the environments that ask for it.
 */

/** The run variable that names the variant. */
export const UI_VARIANT_VARIABLE = 'uiVariant';

export const MAX_ELEMENT_VARIANTS = 20;

export const ElementVariantNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, 'A variant name is letters, digits, "_", "-" or "."');

export const ElementVariantSchema = z.object({
  selector: z.string().trim().min(1, 'A selector is required').max(2000),
  frameSelector: z.string().trim().max(2000).optional().nullable(),
});

export const ElementVariantsSchema = z
  .record(ElementVariantNameSchema, ElementVariantSchema)
  .refine((variants) => Object.keys(variants).length <= MAX_ELEMENT_VARIANTS, {
    message: `At most ${MAX_ELEMENT_VARIANTS} variants per element`,
  });

export type ElementVariant = z.infer<typeof ElementVariantSchema>;
export type ElementVariants = Record<string, ElementVariant>;

/** The variant a run's variables name, or null for the element's own locator. */
export function variantOf(variables: Record<string, unknown> | null | undefined): string | null {
  const value = variables?.[UI_VARIANT_VARIABLE];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The variants a stored value holds, ignoring anything malformed. */
export function readVariants(value: unknown): ElementVariants {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ElementVariants = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    const selector = (entry as { selector?: unknown } | null)?.selector;
    if (typeof selector !== 'string' || selector.trim() === '') continue;
    const frame = (entry as { frameSelector?: unknown }).frameSelector;
    out[name] = { selector, frameSelector: typeof frame === 'string' ? frame : null };
  }
  return out;
}

/**
 * Where the element is for this variant: the variant's locator when it has one, its own otherwise.
 * `variant` is the name the locator came from, null when it is the element's own.
 */
export function locatorFor(
  element: { selector: string; frameSelector?: string | null; variants?: unknown },
  variant: string | null | undefined,
): { selector: string; frameSelector: string | null; variant: string | null } {
  const chosen = variant ? readVariants(element.variants)[variant] : undefined;
  if (chosen)
    return {
      selector: chosen.selector,
      frameSelector: chosen.frameSelector ?? element.frameSelector ?? null,
      variant: variant!,
    };
  return {
    selector: element.selector,
    frameSelector: element.frameSelector ?? null,
    variant: null,
  };
}
