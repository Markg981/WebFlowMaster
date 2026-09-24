import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { privilegedDb } from './db';
import { users, organizations, invitations, auditLog } from '@shared/schema';
import { registrationMode } from './registration';

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

let app: Express;
const configured = process.env.REGISTRATION;

beforeAll(async () => {
  const { setupAuth } = await import('./auth');
  app = express();
  app.use(express.json());
  setupAuth(app);
});

beforeEach(async () => {
  // The default, which the rest of the suite overrides (vitest.config.ts).
  delete process.env.REGISTRATION;
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

afterEach(() => {
  if (configured === undefined) delete process.env.REGISTRATION;
  else process.env.REGISTRATION = configured;
});

const register = (username: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/register').send({ username, password: 'password123', ...extra });

describe('registration by invitation, the default', () => {
  it('lets the first account set the installation up', async () => {
    expect((await request(app).get('/api/registration')).body).toEqual({
      mode: 'invitation',
      selfRegistration: true,
      firstAccount: true,
    });

    const res = await register('founder');

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('owner');
  });

  it('refuses everyone after that who has no invitation', async () => {
    await register('founder').expect(201);

    const res = await register('stranger');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('invitation_required');
    expect(await privilegedDb.select().from(organizations)).toHaveLength(1);
    expect((await request(app).get('/api/registration')).body).toMatchObject({ selfRegistration: false, firstAccount: false });
  });

  it('still accepts an invitation', async () => {
    const founder = await register('founder').expect(201);
    const token = 'b'.repeat(64);
    await privilegedDb.insert(invitations).values({
      organizationId: founder.body.organizationId,
      username: 'colleague',
      role: 'viewer',
      token,
      invitedByUserId: founder.body.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await register('colleague', { invitationToken: token });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(founder.body.organizationId);
  });

  it('lets only one of two simultaneous first registrations through', async () => {
    const [a, b] = await Promise.all([register('first-a'), register('first-b')]);

    expect([a.status, b.status].sort()).toEqual([201, 403]);
    expect(await privilegedDb.select().from(organizations)).toHaveLength(1);
  });
});

describe('open registration', () => {
  it('gives anyone an organization of their own', async () => {
    process.env.REGISTRATION = 'open';
    await register('founder').expect(201);

    const res = await register('somebody-else');

    expect(res.status).toBe(201);
    expect(await privilegedDb.select().from(organizations)).toHaveLength(2);
  });
});

describe('the REGISTRATION setting', () => {
  it('defaults to invitation, and refuses a value it does not know', () => {
    expect(registrationMode({})).toBe('invitation');
    expect(registrationMode({ REGISTRATION: ' Open ' })).toBe('open');
    expect(() => registrationMode({ REGISTRATION: 'yes' })).toThrow(/REGISTRATION/);
  });
});
