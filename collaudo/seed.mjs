/**
 * Starting data for a collaudo cycle that skips the Access area: organizations A (Acme) and B
 * (Beta) and the people the protocol names, all with the password "Collaudo.2026!".
 *
 *   docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
 *     exec api node /collaudo/seed.mjs
 *
 * A full cycle does not use it: cases ACC-01 to ACC-03 create these people through the product,
 * which is what they test. Running it twice changes nothing; an account that exists is left alone.
 *
 * It writes straight to the database, as the operator would, because registration by invitation
 * cannot create a second organization. It refuses to run anywhere but the collaudo stack.
 */
import { createRequire } from 'node:module';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const COLLAUDO_URL = 'https://wfm.collaudo.test';
const PASSWORD = 'Collaudo.2026!';

if (process.env.WEBFLOW_PUBLIC_URL !== COLLAUDO_URL) {
  console.error(`Refusing to run: WEBFLOW_PUBLIC_URL is not ${COLLAUDO_URL}. This script is only for the collaudo stack.`);
  process.exit(2);
}

// The app image's own driver, resolved from its install rather than from this file's folder.
const { Client } = createRequire('/app/')('pg');
const scryptAsync = promisify(scrypt);

/** The same format as server/auth.ts: hex(scrypt(password, salt, 64)).salt */
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${hash.toString('hex')}.${salt}`;
}

const ORGANIZATIONS = [
  {
    name: 'Acme',
    people: [
      ['owner.a', 'owner'],
      ['editor.a', 'editor'],
      ['viewer.a', 'viewer'],
      // Linked to the Keycloak user marco by single sign-on (case SSO-04).
      ['marco@acme.test', 'editor'],
    ],
  },
  {
    name: 'Beta',
    people: [
      ['owner.b', 'owner'],
      // Signing in with Keycloak's luca must be refused: his account is in another organization (SSO-05).
      ['luca@acme.test', 'editor'],
    ],
  },
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const summary = [];
  for (const organization of ORGANIZATIONS) {
    // The organization is the one its first person already belongs to, or a new one.
    const first = await client.query('SELECT organization_id FROM users WHERE username = $1', [organization.people[0][0]]);
    let organizationId = first.rows[0]?.organization_id;
    if (!organizationId) {
      const created = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [organization.name]);
      organizationId = created.rows[0].id;
    }

    for (const [username, role] of organization.people) {
      const existing = await client.query('SELECT organization_id, role FROM users WHERE username = $1', [username]);
      if (existing.rows[0]) {
        summary.push([username, organization.name, existing.rows[0].role, 'already there']);
        continue;
      }
      await client.query(
        "INSERT INTO users (username, password, organization_id, role, kind) VALUES ($1, $2, $3, $4, 'person')",
        [username, await hashPassword(PASSWORD), organizationId, role],
      );
      summary.push([username, organization.name, role, 'created']);
    }
  }

  console.log(`Password for every account created: ${PASSWORD}\n`);
  for (const [username, organization, role, what] of summary) {
    console.log(`${username.padEnd(18)} ${organization.padEnd(6)} ${role.padEnd(7)} ${what}`);
  }
} finally {
  await client.end();
}
