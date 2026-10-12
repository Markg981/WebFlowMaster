import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stripe events as the API sends them (2025-08-27 shapes, trimmed to the fields read), with
 * `ORG_ID` where the application's own metadata names the organization. For tests only.
 */
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/stripe');

export function stripeFixture(name: string, organizationId = 42): string {
  return fs
    .readFileSync(path.join(directory, `${name}.json`), 'utf8')
    .replace(/ORG_ID/g, String(organizationId));
}
