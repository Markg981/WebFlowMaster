import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  BddAgentRequestSchema,
  BddAgentResultSchema,
  BDD_MAX_OUTPUT_BYTES,
  BDD_MAX_DURATION_MS,
  type BddAgentRequest,
  type BddAgentResult,
} from '../shared/bdd-agent';
import {
  OperatorBddProfileSchema,
  resolveProfileSupport,
  type OperatorBddProfile,
} from './bdd-profiles';
import {
  compileGherkinSource,
  contextOfPickle,
  exampleLineOfPickle,
} from '../server/gherkin-source';
import { z } from 'zod';
import { StringDecoder } from 'node:string_decoder';

const active = new Map<string, number>();
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const inputLimit = 22 * 1024 * 1024;
const childReply = z.object({ complete: z.boolean(), result: BddAgentResultSchema }).strict();

function sanitizedEnvironment(profile: OperatorBddProfile): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of [
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    ...profile.environment,
  ])
    if (process.env[name] !== undefined) result[name] = process.env[name];
  return result;
}

/** Normalized evidence only: remove explicit values, credential fields and local paths. */
export function redactBddEvidence(value: string, secrets: string[], paths: string[]): string {
  let clean = value;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length))
    clean = clean.split(secret).join('[redacted]');
  for (const localPath of paths.filter(Boolean).sort((a, b) => b.length - a.length)) {
    clean = clean.split(localPath).join('[support]');
    clean = clean.split(localPath.replace(/\\/g, '/')).join('[support]');
  }
  clean = clean.replace(
    /(authorization["']?\s*[=:]\s*["']?)(?:Bearer|Basic)\s+[^\s,"';]+/gi,
    '$1[redacted]',
  );
  clean = clean.replace(
    /((?:password|passwd|token|secret|authorization|api[_-]?key)["']?\s*[=:]\s*["']?)[^\s,"';]+/gi,
    '$1[redacted]',
  );
  clean = clean
    .replace(/(?:file:\/\/\/|[A-Za-z]:[\\/])[^\s)]+/g, '[path]')
    .replace(/\n\s*at .*/g, '\n[stack omitted]');
  clean = clean.replace(/(^|[\s("'=])\/[^\s)"']+/g, '$1[path]');
  return clean.slice(0, 256 * 1024);
}

async function terminateTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* Process group is already gone. */
    }
    return;
  }
  // The absolute system executable and numeric PID are operator-controlled, never tenant input.
  const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  const run = (executable: string, args: string[]) =>
    new Promise<void>((resolve) => {
      const killer = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => {
        killer.kill();
        resolve();
      }, 5000);
      killer.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
      killer.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  await run(taskkill, ['/pid', String(pid), '/T', '/F']);
  // Unreferenced children can outlive an already-exited root. Windows retains their
  // ParentProcessId, so discover and stop that tree even when taskkill has no root.
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = `$bddProcesses=Get-CimInstance Win32_Process; $bddParents=@(${pid}); $bddOwned=@(); do { $bddNext=@($bddProcesses | Where-Object { $bddParents -contains $_.ParentProcessId -and $bddOwned -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId }); $bddOwned+=$bddNext; $bddParents=$bddNext } while ($bddNext.Count -gt 0); [array]::Reverse($bddOwned); foreach ($bddPid in $bddOwned) { Stop-Process -Id $bddPid -Force -ErrorAction SilentlyContinue }`;
  await run(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
    script,
  ]);
}

export async function runBddOnDedicatedHost(
  rawRequest: BddAgentRequest,
  profiles: readonly OperatorBddProfile[],
  signal?: AbortSignal,
): Promise<BddAgentResult> {
  const started = Date.now();
  const fail = (error: string, cancelled = false): BddAgentResult => ({
    status: cancelled ? 'cancelled' : 'failed',
    durationMs: Date.now() - started,
    steps: [],
    error,
  });
  let runDirectory: string | undefined,
    key: string | undefined,
    acquired = false;
  let request: BddAgentRequest | undefined, profile: OperatorBddProfile | undefined;
  try {
    request = BddAgentRequestSchema.parse(rawRequest);
    const candidate = profiles.find(
      (item) => item.id === request!.profile.id && item.revision === request!.profile.revision,
    );
    if (!candidate) return fail('Authorized BDD profile or revision is unavailable');
    profile = OperatorBddProfileSchema.parse(candidate);
    key = `${profile.projectDirectory}:${profile.id}`;
    if ((active.get(key) ?? 0) >= profile.maxConcurrency)
      return fail('BDD profile concurrency limit reached');
    active.set(key, (active.get(key) ?? 0) + 1);
    acquired = true;
    if (signal?.aborted) return fail('BDD execution cancelled', true);
    const compiled = compileGherkinSource(request.source, request.uri);
    if (
      compiled.pickles.filter((pickle) => {
        const context = contextOfPickle(compiled, pickle);
        return (
          context.scenario.location.line === request!.scenarioLine &&
          exampleLineOfPickle(context, pickle) === request!.exampleLine
        );
      }).length !== 1
    )
      return fail('BDD selector must select exactly one scenario or Examples row');
    await resolveProfileSupport(profile);
    if (signal?.aborted) return fail('BDD execution cancelled', true);
    runDirectory = await mkdtemp(path.join(os.tmpdir(), 'wfm-bdd-'));
    const environment = sanitizedEnvironment(profile);
    const secrets = [
      ...Object.values(request.variables),
      ...profile.environment.map((name) => environment[name] ?? ''),
    ];
    const redacted = (result: BddAgentResult): BddAgentResult =>
      BddAgentResultSchema.parse({
        ...result,
        ...(result.error
          ? {
              error: redactBddEvidence(result.error, secrets, [
                profile!.projectDirectory,
                runDirectory!,
              ]),
            }
          : {}),
        steps: result.steps.map((step) => ({
          ...step,
          name: redactBddEvidence(step.name, secrets, [
            profile!.projectDirectory,
            runDirectory!,
          ]).slice(0, 64 * 1024),
          ...(step.error
            ? {
                error: redactBddEvidence(step.error, secrets, [
                  profile!.projectDirectory,
                  runDirectory!,
                ]),
              }
            : {}),
        })),
        ...(result.attachments
          ? {
              attachments: result.attachments.map((attachment) => ({
                mediaType: 'text/plain',
                text: redactBddEvidence(attachment.text, secrets, [
                  profile!.projectDirectory,
                  runDirectory!,
                ]),
              })),
            }
          : {}),
      });
    const sibling = path.join(moduleDirectory, 'wfm-bdd-child.mjs');
    let childArgs: string[];
    try {
      await access(sibling);
      childArgs = [sibling];
    } catch {
      childArgs = ['--import', 'tsx', path.join(moduleDirectory, 'bdd-child.ts')];
    }
    const payload = JSON.stringify({ request, profile, runDirectory });
    if (Buffer.byteLength(payload) > inputLimit) return fail('BDD child input limit exceeded');
    const result = await new Promise<BddAgentResult>((resolve) => {
      const child = spawn(process.execPath, childArgs, {
        cwd: profile!.projectDirectory,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      });
      let bytes = 0,
        diagnostic = '',
        settled = false,
        reason: string | undefined,
        cancelled = false;
      let exitCode: number | null | undefined;
      let cleanup: Promise<void> | undefined;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanupTree = () => {
        cleanup ??= child.pid ? terminateTree(child.pid) : Promise.resolve();
        return cleanup;
      };
      const decoder = new StringDecoder('utf8');
      const stop = (error: string, isCancelled = false) => {
        if (reason) return;
        reason = error;
        cancelled = isCancelled;
        void cleanupTree();
      };
      const abort = () => stop('BDD execution cancelled', true);
      const timer = setTimeout(
        () => stop('BDD execution deadline exceeded'),
        Math.min(request!.timeoutMs, profile!.maxDurationMs, BDD_MAX_DURATION_MS),
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const consume = (chunk: Buffer, resultChannel = false) => {
        bytes += chunk.length;
        if (bytes > BDD_MAX_OUTPUT_BYTES) {
          stop('BDD child output exceeds 8 MiB');
          return;
        }
        if (resultChannel) diagnostic += decoder.write(chunk);
      };
      child.stdout!.on('data', (chunk: Buffer) => consume(chunk));
      child.stderr!.on('data', (chunk: Buffer) => consume(chunk));
      const resultStream = child.stdio[3] as NodeJS.ReadableStream;
      resultStream.on('data', (chunk: Buffer) => consume(chunk, true));
      const finish = async (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (drainTimer) clearTimeout(drainTimer);
        signal?.removeEventListener('abort', abort);
        diagnostic += decoder.end();
        await cleanupTree();
        if (reason) return resolve(fail(reason, cancelled));
        try {
          const reply = childReply.parse(JSON.parse(diagnostic));
          if (exitCode !== 0 || code !== 0 || !reply.complete)
            return resolve(
              redacted(
                reply.result.status === 'failed'
                  ? reply.result
                  : fail('Incomplete Cucumber child result or unsuccessful exit'),
              ),
            );
          resolve(redacted(reply.result));
        } catch {
          resolve(fail('Incomplete or malformed Cucumber child result'));
        }
      };
      child.once('error', () => {
        reason = 'Unable to start dedicated Cucumber child';
        void finish(null);
      });
      child.once('exit', (code) => {
        exitCode = code;
        clearTimeout(timer);
        // A descendant can inherit the root's output pipes and delay `close`.
        // Terminate it as soon as the root exits, then drain every descriptor
        // before validating the terminal result and successful exit below.
        void cleanupTree();
        drainTimer = setTimeout(() => {
          stop('BDD child output did not close after exit');
          child.stdout!.destroy();
          child.stderr!.destroy();
          (resultStream as import('node:stream').Readable).destroy();
        }, 5000);
      });
      child.once('close', (code) => {
        void finish(code);
      });
      child.stdin!.on('error', () => {
        /* Early exit is checked against terminal events and exit status. */
      });
      child.stdin!.end(payload);
    });
    return result;
  } catch {
    // Parser/module/config errors can contain raw source, operator paths or credentials.
    return fail('BDD request, selector or operator support configuration is invalid');
  } finally {
    if (runDirectory) await rm(runDirectory, { recursive: true, force: true, maxRetries: 3 });
    if (acquired && key) {
      const remaining = (active.get(key) ?? 1) - 1;
      if (remaining > 0) active.set(key, remaining);
      else active.delete(key);
    }
  }
}

export function serveBddSession(
  socket: WebSocket,
  authorizedProfile: { id: string; revision: string },
  profiles: readonly OperatorBddProfile[],
  done: () => void,
): void {
  const controller = new AbortController();
  let finished = false;
  let execution: Promise<void> | undefined;
  const complete = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    controller.abort();
    if (execution) void execution.finally(done);
    else done();
  };
  const timer = setTimeout(() => socket.terminate(), BDD_MAX_DURATION_MS + 10000);
  socket.once('close', complete);
  socket.on('error', () => socket.terminate());
  socket.once('message', (raw) => {
    execution = (async () => {
      let result: BddAgentResult;
      try {
        const byteLength = Array.isArray(raw)
          ? raw.reduce((total, part) => total + part.length, 0)
          : raw.byteLength;
        if (byteLength > inputLimit) throw new Error('oversize');
        const request = BddAgentRequestSchema.parse(JSON.parse(raw.toString()));
        if (
          request.profile.id !== authorizedProfile.id ||
          request.profile.revision !== authorizedProfile.revision
        )
          throw new Error('binding');
        result = await runBddOnDedicatedHost(request, profiles, controller.signal);
      } catch {
        result = {
          status: 'failed',
          durationMs: 0,
          steps: [],
          error: 'BDD request does not match the authorized profile or limits',
        };
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ result }), () => socket.close());
    })();
  });
}
