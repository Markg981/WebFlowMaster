/**
 * Reports what state the database schema is in, and what to run about it.
 *
 * `npm run db:doctor`
 *
 * Exists because the answer used to be unavailable without reading a stack trace. A
 * database created with `db:push` fails `db:migrate` with `relation "api_test_history"
 * already exists`, which names a symptom, and boots the server without complaint while
 * missing the row-level security migrations. This says which of the two happened.
 */
import 'dotenv/config';
import { inspectSchemaState, describeSchemaState } from '../server/schema-state';
import { closeDb } from '../server/db';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set.');
  process.exit(2);
}

const state = await inspectSchemaState();

console.log(`Database: ${process.env.DATABASE_URL}`);
console.log(`State:    ${state.kind}`);
console.log(`Applied:  ${state.appliedMigrations} of ${state.expectedMigrations} migrations`);
console.log('');
console.log(describeSchemaState(state));

await closeDb();

// Non-zero for the two states that need action, so this is usable as a deployment gate.
process.exit(state.kind === 'ready' ? 0 : 1);
