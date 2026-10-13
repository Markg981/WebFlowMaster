import fs from 'fs';
import path from 'path';
import { randomInt } from 'crypto';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { sharedStore } from '../../platform/middleware/rate-limit-store';
import { asyncRouter } from '../../platform/middleware/async-router';
import { APP_ROOT } from '../../platform/app-root';

/**
 * The Northwind Shop: the storefront the sample project tests (server/authoring/sample-project.ts).
 *
 * Served by the application itself, so the sample works on every installation the moment it is
 * created, air-gapped ones included: its web tests open these pages and its API tests call the
 * small orders API below. Nothing here reads or writes the database or knows who is calling.
 *
 * The pages are static files in client/public/demo-shop, which the client build copies to
 * dist/public. They are served from here in development too, where Vite would answer a folder
 * path with the application's own index.html.
 */

export const DEMO_SHOP_PATH = '/demo-shop';

/** Built image first, then the sources: the first that exists. */
export function demoShopDir(root: string = APP_ROOT): string | undefined {
  return [
    path.join(root, 'dist', 'public', 'demo-shop'),
    path.join(root, 'client', 'public', 'demo-shop'),
  ].find((dir) => fs.existsSync(dir));
}

const router = asyncRouter();

/**
 * Anyone can reach these, signed in or not, so they are limited per address. A sample run makes a
 * handful of calls; 120 a minute leaves room for several people trying it at once behind one NAT.
 */
const demoShopLimiter = rateLimit({
  windowMs: 60_000,
  limit: process.env.NODE_ENV === 'test' ? 100_000 : 120,
  store: sharedStore('demo-shop'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: { error: 'Too many requests, slow down.' },
});

const API = `${DEMO_SHOP_PATH}/api`;

router.get(`${API}/health`, demoShopLimiter, (_req, res) => {
  res.json({ status: 'ok', service: 'northwind-shop' });
});

const orderSchema = z.object({
  product: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(99),
});

/**
 * Places an order and answers with its number. Nothing is stored: the shop exists to be tested,
 * and an order the sample's next request reads back is confirmed whatever its number.
 */
router.post(`${API}/orders`, demoShopLimiter, express.json({ limit: '4kb' }), (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'An order needs a product and a quantity from 1 to 99.' });
  }
  res.status(201).json({ id: randomInt(10_000, 100_000), ...parsed.data, status: 'received' });
});

router.get(`${API}/orders/:id`, demoShopLimiter, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 10_000 || id >= 100_000) {
    return res.status(404).json({ error: 'No such order.' });
  }
  res.json({ id, status: 'confirmed' });
});

router.use(`${API}`, demoShopLimiter, (_req, res) => {
  res.status(404).json({ error: 'No such endpoint.' });
});

const dir = demoShopDir();
if (dir) router.use(DEMO_SHOP_PATH, demoShopLimiter, express.static(dir));

export default router;
