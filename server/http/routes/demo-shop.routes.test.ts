import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import demoShopRoutes, { demoShopDir } from './demo-shop.routes';

/** The Northwind Shop the sample project tests: its pages and its orders API. */

const app = express();
app.use(demoShopRoutes);

describe('demo shop API', () => {
  it('answers the health check', async () => {
    const res = await request(app).get('/demo-shop/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'northwind-shop' });
  });

  it('places an order and reads it back by its number', async () => {
    const placed = await request(app)
      .post('/demo-shop/api/orders')
      .send({ product: 'Espresso Roast', quantity: 2 });
    expect(placed.status).toBe(201);
    expect(placed.body).toMatchObject({
      product: 'Espresso Roast',
      quantity: 2,
      status: 'received',
    });

    const read = await request(app).get(`/demo-shop/api/orders/${placed.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ id: placed.body.id, status: 'confirmed' });
  });

  it('refuses a malformed order and an unknown number', async () => {
    expect(
      (await request(app).post('/demo-shop/api/orders').send({ product: '', quantity: 0 })).status,
    ).toBe(400);
    expect((await request(app).get('/demo-shop/api/orders/12')).status).toBe(404);
    expect((await request(app).get('/demo-shop/api/nothing')).status).toBe(404);
  });
});

describe('demo shop pages', () => {
  const dir = demoShopDir()!;

  it('are served, folder paths included', async () => {
    const res = await request(app).get('/demo-shop/login/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Northwind');
    expect((await request(app).get('/demo-shop/login')).status).toBe(301);
  });

  // The application serves them under its Content Security Policy, which allows scripts from
  // 'self' only: an inline script would do nothing, and the sample's tests would fail.
  it('have no inline scripts, and link with relative paths', () => {
    const pages = ['index.html', 'login/index.html', 'catalog/index.html', 'checkout/index.html'];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(dir, page), 'utf8');
      expect(html, page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html, page).not.toMatch(/(?:href|src)="\//);
    }
  });
});
