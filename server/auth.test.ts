import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { db } from './db';
import { users } from '@shared/schema';

// Only the logger is mocked; auth runs against the real (PGlite) test database
// with an in-memory session store (NODE_ENV=test).
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  const { setupAuth } = await import('./auth');
  app = express();
  app.use(express.json());
  setupAuth(app);
});

beforeEach(async () => {
  await db.delete(users);
});

const validCreds = { username: 'alice', password: 'password123' };

describe('POST /api/register', () => {
  it('creates a user and returns 201 without exposing the password hash', async () => {
    const res = await request(app).post('/api/register').send(validCreds).expect(201);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].password).not.toBe('password123'); // stored hashed
  });

  it('rejects a too-short password with 400', async () => {
    await request(app).post('/api/register').send({ username: 'bob', password: 'short' }).expect(400);
  });

  it('rejects a too-short username with 400', async () => {
    await request(app).post('/api/register').send({ username: 'ab', password: 'password123' }).expect(400);
  });

  it('rejects a duplicate username with 400', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    await request(app).post('/api/register').send(validCreds).expect(400);
  });
});

describe('POST /api/login', () => {
  it('rejects wrong credentials with 401', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    await request(app).post('/api/login').send({ username: 'alice', password: 'wrong' }).expect(401);
  });

  it('accepts correct credentials and returns the user without the password', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    const agent = request.agent(app);
    const res = await agent.post('/api/login').send(validCreds).expect(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();
  });
});

describe('GET /api/user', () => {
  it('returns 401 when not authenticated', async () => {
    await request(app).get('/api/user').expect(401);
  });

  it('returns the current user (no password) once logged in', async () => {
    const agent = request.agent(app);
    await agent.post('/api/register').send(validCreds).expect(201); // register also logs in
    const res = await agent.get('/api/user').expect(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();
  });
});
