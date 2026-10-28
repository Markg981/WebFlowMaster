import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'fs-extra';

vi.mock('../../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

/**
 * The Excel upload wrote whatever an account sent to uploads/, of any size and any type, and
 * kept it there when it did not parse. These hold the three limits: size, type, and cleanup.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let app: express.Express;
let maxBytes: number;

async function workbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Tests');
  sheet.addRow(['Test Case ID', 'Description']);
  sheet.addRow(['TC-1', 'Sign in']);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function leftInUploads(): Promise<number> {
  return (await fs.pathExists('uploads')) ? (await fs.readdir('uploads')).length : 0;
}

beforeAll(async () => {
  const routes = await import('./uploads.routes');
  maxBytes = routes.EXCEL_UPLOAD_MAX_BYTES;
  app = express();
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, organizationId: 1, role: 'editor' };
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(routes.default);
});

describe('POST /api/upload-excel', () => {
  it('parses an .xlsx and removes it afterwards', async () => {
    const before = await leftInUploads();
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', await workbook(), { filename: 'tests.xlsx', contentType: XLSX });
    expect(res.status).toBe(200);
    expect(await leftInUploads()).toBe(before);
  });

  it('refuses another type with 415', async () => {
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', Buffer.from('a,b\n1,2'), { filename: 'tests.csv', contentType: 'text/csv' });
    expect(res.status).toBe(415);
  });

  it('refuses an .xlsx name with another type', async () => {
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', Buffer.from('<html>'), { filename: 'tests.xlsx', contentType: 'text/html' });
    expect(res.status).toBe(415);
  });

  it('refuses a file over the limit with 413 and keeps nothing', async () => {
    const before = await leftInUploads();
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', Buffer.alloc(maxBytes + 1), { filename: 'big.xlsx', contentType: XLSX });
    expect(res.status).toBe(413);
    expect(await leftInUploads()).toBe(before);
  });

  it('refuses a zip bomb (tiny file, huge declared XML) with 413 before parsing', async () => {
    const before = await leftInUploads();
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(64 * 1024, 0x61));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    // The guard trusts the central directory, as a real bomb's would be read: declare 120 MB
    // there instead of deflating 120 MB here, which took most of the 30 s timeout on CI.
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(120 * 1024 * 1024, central + 24);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', bomb, { filename: 'bomb.xlsx', contentType: XLSX });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/expands|compression/);
    expect(await leftInUploads()).toBe(before);
  });

  it('removes a file that does not parse', async () => {
    const before = await leftInUploads();
    const res = await request(app)
      .post('/api/upload-excel')
      .attach('file', Buffer.from('not a workbook'), {
        filename: 'broken.xlsx',
        contentType: XLSX,
      });
    expect(res.status).toBe(500);
    expect(await leftInUploads()).toBe(before);
  });

  it('refuses a viewer before reading the file', async () => {
    const viewerApp = express();
    viewerApp.use((req, _res, next) => {
      (req as any).user = { id: 2, organizationId: 1, role: 'viewer' };
      (req as any).isAuthenticated = () => true;
      next();
    });
    viewerApp.use((await import('./uploads.routes')).default);
    const res = await request(viewerApp)
      .post('/api/upload-excel')
      .attach('file', await workbook(), { filename: 'tests.xlsx', contentType: XLSX });
    expect(res.status).toBe(403);
  });
});
