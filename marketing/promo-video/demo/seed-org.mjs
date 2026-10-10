/**
 * The organization the promo video is filmed in: "Northwind Commerce", with one owner, maya.
 *
 *   docker compose -p wfm-collaudo --env-file collaudo/collaudo.env -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
 *     exec -T api node --input-type=module < marketing/promo-video/demo/seed-org.mjs
 *
 * The collaudo organizations are full of case names ("PLN09 Flaky Rerun 1790599557623"), which
 * is right for a test cycle and wrong on screen. This one starts empty; build-data.mjs then fills
 * it through the product's own API, so every run in the video is a real one.
 *
 * Like collaudo/seed.mjs it writes the account straight to the database (registration by
 * invitation cannot create a second organization) and refuses to run anywhere but that stack.
 * Running it twice changes nothing.
 */
import { createRequire } from 'node:module';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const COLLAUDO_URL = 'https://wfm.collaudo.test';
const ORGANIZATION = 'Northwind Commerce';
const USERNAME = 'maya';
const PASSWORD = 'Demo.Video.2026!';

if (process.env.WEBFLOW_PUBLIC_URL !== COLLAUDO_URL) {
  console.error(`Refusing to run: WEBFLOW_PUBLIC_URL is not ${COLLAUDO_URL}. This script is only for the collaudo stack.`);
  process.exit(2);
}

const { Client } = createRequire('/app/')('pg');
const scryptAsync = promisify(scrypt);

/** The same format as server/auth.ts: hex(scrypt(password, salt, 64)).salt */
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${hash.toString('hex')}.${salt}`;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const existing = await client.query('SELECT id FROM users WHERE username = $1', [USERNAME]);
  if (existing.rows[0]) {
    console.log(`${USERNAME} already exists.`);
  } else {
    const org = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [ORGANIZATION]);
    await client.query(
      "INSERT INTO users (username, password, organization_id, role, kind) VALUES ($1, $2, $3, 'owner', 'person')",
      [USERNAME, await hashPassword(PASSWORD), org.rows[0].id],
    );
    console.log(`Created ${USERNAME} (owner of ${ORGANIZATION}), password ${PASSWORD}`);
  }
} finally {
  await client.end();
}
