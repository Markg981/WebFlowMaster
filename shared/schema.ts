/**
 * The database schema. Import it from here (`@shared/schema`): the files under shared/schema/
 * split it by domain, the same domains docs/en/internals/database-schema.md describes, and
 * which file holds a table is not part of its interface.
 */
export * from './schema/identity';
export * from './schema/authoring';
export * from './schema/api-testing';
export * from './schema/execution';
export * from './schema/environments';
export * from './schema/integrations';
export * from './schema/relations';
export * from './schema/tenancy';
export * from './comments';
export * from './dashboard-layout';
export * from './mail-delivery';
export * from './mail-settings';
export * from './mail-templates';
export {
  EXECUTION_STATUSES,
  IN_FLIGHT_EXECUTION_STATUSES,
  isExecutionInFlight,
  type ExecutionStatus,
  type ExecutionTrigger,
} from './execution-status';
