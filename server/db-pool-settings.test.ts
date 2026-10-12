import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POOL_SETTINGS,
  readPoolSettings,
  sessionSetupStatements,
} from './db-pool-settings';

describe('readPoolSettings', () => {
  it('bounds every wait when nothing is configured', () => {
    const settings = readPoolSettings({});

    expect(settings).toEqual(DEFAULT_POOL_SETTINGS);
    expect(settings.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(settings.statementTimeoutMs).toBeGreaterThan(0);
    expect(settings.idleInTransactionTimeoutMs).toBeGreaterThan(0);
  });

  it('takes each value from its environment variable', () => {
    const settings = readPoolSettings({
      PG_POOL_MAX: '25',
      PG_CONNECTION_TIMEOUT_MS: '2000',
      PG_IDLE_TIMEOUT_MS: '10000',
      PG_STATEMENT_TIMEOUT_MS: '0',
      PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: ' 120000 ',
    });

    expect(settings).toEqual({
      max: 25,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statementTimeoutMs: 0,
      idleInTransactionTimeoutMs: 120000,
    });
  });

  it('treats an empty value as unset', () => {
    expect(readPoolSettings({ PG_POOL_MAX: '' }).max).toBe(DEFAULT_POOL_SETTINGS.max);
  });

  it.each([
    ['PG_POOL_MAX', '0'],
    ['PG_POOL_MAX', 'ten'],
    ['PG_STATEMENT_TIMEOUT_MS', '30s'],
    ['PG_CONNECTION_TIMEOUT_MS', '-1'],
    ['PG_IDLE_TIMEOUT_MS', '1.5'],
  ])('refuses %s=%s rather than falling back to the default', (name, value) => {
    expect(() => readPoolSettings({ [name]: value })).toThrow(name);
  });
});

describe('sessionSetupStatements', () => {
  it('sets the time zone and both server-side timeouts in one batch', () => {
    const statements = sessionSetupStatements(
      { ...DEFAULT_POOL_SETTINGS, statementTimeoutMs: 1234, idleInTransactionTimeoutMs: 5678 },
      'UTC',
    );

    expect(statements).toBe(
      "SET TIME ZONE 'UTC'; SET statement_timeout = 1234; " +
        'SET idle_in_transaction_session_timeout = 5678',
    );
  });
});
