import { z } from 'zod';

/**
 * The update form of a create schema: every field optional, and no defaults.
 *
 * In zod 4 a `.default()` still fills in a field that `.partial()` made optional, so a PATCH
 * carrying only `name` would reset every defaulted field (locales, retry policy, elements…)
 * to its default. An update must leave a field it does not mention alone.
 */
export function partialUpdate<Shape extends z.ZodRawShape, Config extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<Shape, Config>,
): z.ZodObject<{ -readonly [K in keyof Shape]: z.ZodOptional<Shape[K]> }, Config> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape))
    shape[key] = withoutDefault(field as z.ZodType);
  return schema.extend(shape).partial() as unknown as z.ZodObject<
    { -readonly [K in keyof Shape]: z.ZodOptional<Shape[K]> },
    Config
  >;
}

function withoutDefault(field: z.ZodType): z.ZodType {
  if (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) {
    return withoutDefault(field.unwrap() as z.ZodType);
  }
  if (field instanceof z.ZodOptional) return withoutDefault(field.unwrap() as z.ZodType).optional();
  if (field instanceof z.ZodNullable) return withoutDefault(field.unwrap() as z.ZodType).nullable();
  return field;
}
