/**
 * Where a test's SQL runs: its data fixtures and its queryDatabase steps.
 *
 * On the server (or the worker) by default. For a plan on an agent pool, on the agent
 * (server/runtime/agents/agent-database.ts), as its browsers and API requests already do: the
 * application's database is often reachable only from the agent's network, a local DMO for one.
 */

import {
  runDatabaseQuery,
  vetDatabaseTarget,
  type DatabaseKind,
  type DatabaseRunner,
  type DatabaseTarget,
} from '../database-step';
import { openSqlSession, type SqlSessionFactory } from './sql-session';

export interface DataRunner {
  /** For the report: `agent pool "<pool>"`, or absent on the server. */
  readonly where?: string;
  /** The egress check before a connection; on an agent, the agent's network decides. */
  vet(kind: DatabaseKind, url: string): Promise<DatabaseTarget>;
  /** A connection for the length of a data fixture. */
  openSession: SqlSessionFactory;
  /** One queryDatabase statement on a connection of its own. */
  query: DatabaseRunner;
}

export const localDataRunner: DataRunner = {
  vet: (kind, url) => vetDatabaseTarget(kind, url),
  openSession: openSqlSession,
  query: runDatabaseQuery,
};
