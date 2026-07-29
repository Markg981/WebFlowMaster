import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStack, resolveOrigin } from './stack';

let repoRoot: string;

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-stack-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'server', 'sample.ts'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('parseStack', () => {
  it('parses named frames and marks project files as app frames', () => {
    const stack = [
      'TypeError: boom',
      `    at PlaywrightService.run (${path.join(repoRoot, 'server', 'sample.ts')}:10:5)`,
      `    at Layer.handle (${path.join(repoRoot, 'node_modules', 'express', 'lib', 'layer.js')}:95:5)`,
    ].join('\n');

    const frames = parseStack(stack, repoRoot);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      functionName: 'PlaywrightService.run',
      line: 10,
      column: 5,
      app: true,
    });
    expect(frames[0].file).toBe('server/sample.ts');
    expect(frames[1].app).toBe(false);
  });

  it('parses anonymous and async frames', () => {
    const stack = [
      'Error: boom',
      `    at ${path.join(repoRoot, 'server', 'sample.ts')}:3:1`,
      `    at async ${path.join(repoRoot, 'server', 'sample.ts')}:4:2`,
    ].join('\n');

    const frames = parseStack(stack, repoRoot);

    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBeNull();
    expect(frames[1].line).toBe(4);
  });

  it('parses file:// URLs', () => {
    const fileUrl = new URL(
      `file:///${path.join(repoRoot, 'server', 'sample.ts').replace(/\\/g, '/')}`,
    ).href;
    const frames = parseStack(`Error: boom\n    at run (${fileUrl}:7:3)`, repoRoot);

    expect(frames[0].file).toBe('server/sample.ts');
    expect(frames[0].line).toBe(7);
  });

  it('returns an empty array for a missing stack', () => {
    expect(parseStack(undefined, repoRoot)).toEqual([]);
  });
});

describe('resolveOrigin', () => {
  it('picks the first app frame and reads the surrounding source', () => {
    const frames = parseStack(
      `Error: boom\n    at run (${path.join(repoRoot, 'node_modules', 'x', 'i.js')}:1:1)\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:10:5)`,
      repoRoot,
    );

    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.file).toBe('server/sample.ts');
    expect(origin?.line).toBe(10);
    // Line numbers are right-aligned to the widest one in the window, so a two-digit
    // window pads to five columns; the failing line is marked with ">" not "|".
    expect(origin?.source).toContain('   10 > const line10 = 10;');
    expect(origin?.source).toContain('    9 | const line9 = 9;');
    expect(origin?.unresolved).toBeUndefined();
  });

  it('clamps the window at the start of the file', () => {
    const frames = parseStack(
      `Error: boom\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:2:1)`,
      repoRoot,
    );
    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.source[0]).toBe('   1 | const line1 = 1;');
  });

  it('marks the origin unresolved when the file no longer exists', () => {
    const frames = parseStack(
      `Error: boom\n    at run (${path.join(repoRoot, 'server', 'gone.ts')}:5:1)`,
      repoRoot,
    );
    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.unresolved).toBeTruthy();
    expect(origin?.source).toEqual([]);
  });

  it('marks the origin unresolved when the line is past the end of the file', () => {
    const frames = parseStack(
      `Error: boom\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:9999:1)`,
      repoRoot,
    );
    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.unresolved).toContain('9999');
    expect(origin?.source).toEqual([]);
  });

  it('returns null when there is no app frame at all', () => {
    const frames = parseStack(
      `Error: boom\n    at x (${path.join(repoRoot, 'node_modules', 'y', 'z.js')}:1:1)`,
      repoRoot,
    );
    expect(resolveOrigin(frames, repoRoot)).toBeNull();
  });
});
