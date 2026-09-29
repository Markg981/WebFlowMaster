/**
 * Spreads the Northwind Commerce runs over the last two weeks, for the dashboard's 30-day trend.
 *
 *   docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
 *     exec -T api node --input-type=module < marketing/promo-video/demo/spread-history.mjs
 *
 * build-data.mjs makes every run in the same few minutes, so the trend chart is one bar at the
 * right edge. The runs, their results and their logs are real; only their dates move, each run
 * keeping its own duration and its order. The one failed run lands two days ago. Demo data for
 * the promo video only: it refuses to touch anything but the Northwind organization on the
 * collaudo stack.
 */
import { createRequire } from 'node:module';

const COLLAUDO_URL = 'https://wfm.collaudo.test';
const ORGANIZATION = 'Northwind Commerce';
const DAYS = 14;

if (process.env.WEBFLOW_PUBLIC_URL !== COLLAUDO_URL) {
  console.error(`Refusing to run: WEBFLOW_PUBLIC_URL is not ${COLLAUDO_URL}.`);
  process.exit(2);
}

const { Client } = createRequire('/app/')('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const org = await client.query('SELECT id FROM organizations WHERE name = $1', [ORGANIZATION]);
  if (!org.rows[0]) throw new Error(`No organization called ${ORGANIZATION}: run seed-org.mjs first.`);
  const runs = await client.query(
    `SELECT id, status, started_at FROM test_plan_executions
      WHERE organization_id = $1 AND started_at IS NOT NULL ORDER BY started_at`,
    [org.rows[0].id],
  );

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const failed = runs.rows.filter((r) => r.status === 'failed');
  const others = runs.rows.filter((r) => r.status !== 'failed');

  await client.query('BEGIN');
  const move = async (run, target) => {
    const shift = `${Math.round((target - new Date(run.started_at).getTime()) / 1000)} seconds`;
    await client.query(
      `UPDATE test_plan_executions SET started_at = started_at + $2::interval, completed_at = completed_at + $2::interval,
              queued_at = queued_at + $2::interval, heartbeat_at = heartbeat_at + $2::interval WHERE id = $1`,
      [run.id, shift],
    );
    await client.query(
      `UPDATE report_test_case_results SET started_at = started_at + $2::interval, completed_at = completed_at + $2::interval
        WHERE test_plan_execution_id = $1`,
      [run.id, shift],
    );
    await client.query('UPDATE execution_logs SET "timestamp" = "timestamp" + $2::interval WHERE test_plan_execution_id = $1', [run.id, shift]);
  };

  // Evenly over the last DAYS days, oldest first, at plausible working hours.
  for (const [i, run] of others.entries()) {
    const daysAgo = DAYS - Math.floor((i * DAYS) / Math.max(others.length, 1));
    const target = new Date(now - daysAgo * day);
    target.setHours(9 + (i % 9), (i * 17) % 60, 0, 0);
    await move(run, target.getTime());
  }
  for (const run of failed) {
    const target = new Date(now - 2 * day);
    target.setHours(15, 42, 0, 0);
    await move(run, target.getTime());
  }
  await client.query('COMMIT');
  console.log(`Moved ${runs.rows.length} runs over the last ${DAYS} days (${failed.length} failed, two days ago).`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
