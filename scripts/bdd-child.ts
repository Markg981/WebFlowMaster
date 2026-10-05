import { writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { z } from 'zod';
import type { Envelope, TestCase, Pickle } from '@cucumber/messages';
import {
  BddAgentRequestSchema,
  BddAgentResultSchema,
  type BddStepResult,
} from '../shared/bdd-agent';
import {
  compileGherkinSource,
  contextOfPickle,
  exampleLineOfPickle,
} from '../server/gherkin-source';
import { OperatorBddProfileSchema, resolveProfileSupport } from './bdd-profiles';

// The dedicated result descriptor cannot be confused with support-code stdout.
const output = createWriteStream('', { fd: 3, autoClose: false });
const started = Date.now();
const MAX_INPUT = 22 * 1024 * 1024;
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > MAX_INPUT) throw new Error('BDD child input limit exceeded');
    chunks.push(Buffer.from(chunk));
  }
  const input = z
    .object({
      request: BddAgentRequestSchema,
      profile: OperatorBddProfileSchema,
      runDirectory: z.string().refine(path.isAbsolute),
    })
    .strict()
    .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const { request, profile, runDirectory } = input;
  if (request.profile.id !== profile.id || request.profile.revision !== profile.revision)
    throw new Error('BDD profile revision mismatch');
  const compiled = compileGherkinSource(request.source, request.uri);
  const selected = compiled.pickles.filter((pickle) => {
    const context = contextOfPickle(compiled, pickle);
    return (
      context.scenario.location.line === request.scenarioLine &&
      exampleLineOfPickle(context, pickle) === request.exampleLine
    );
  });
  if (selected.length !== 1)
    throw new Error('BDD selector must select exactly one scenario or Examples row');
  const support = await resolveProfileSupport(profile);
  const featurePath = path.join(runDirectory, request.uri);
  await writeFile(featurePath, request.source, { mode: 0o600 });
  const api = (await import(
    pathToFileURL(support.apiPath).href
  )) as typeof import('@cucumber/cucumber/api');
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const environment = {
    cwd: profile.projectDirectory,
    env: process.env,
    stdout: sink,
    stderr: sink,
  };
  const { runConfiguration } = await api.loadConfiguration(
    {
      file: false,
      provided: {
        paths: [`${featurePath}:${request.exampleLine ?? request.scenarioLine}`],
        require: support.requirePaths,
        import: support.importPaths,
        strict: true,
        publish: false,
        parallel: 0,
        retry: 0,
        worldParameters: request.variables,
      },
    },
    environment,
  );
  runConfiguration.formats.publish = false;
  runConfiguration.formats.files = {};
  runConfiguration.plugins = { specifiers: [], options: {} };
  const plan = await api.loadSources(runConfiguration.sources, environment);
  if (
    plan.errors.length ||
    plan.plan.length !== 1 ||
    plan.plan[0].location.line !== (request.exampleLine ?? request.scenarioLine)
  )
    throw new Error('Cucumber source plan must select exactly the authorized scenario');
  if (profile.loader === 'tsx') {
    const projectRequire = createRequire(path.join(profile.projectDirectory, 'package.json'));
    (await import(pathToFileURL(projectRequire.resolve('tsx/esm/api')).href)).register();
    projectRequire('tsx/cjs/api').register();
  }
  const cases = new Map<string, TestCase>(),
    pickles = new Map<string, Pickle>(),
    hookNames = new Map<string, string>();
  const steps: BddStepResult[] = [],
    attachments: { mediaType: 'text/plain'; text: string }[] = [];
  let runStarted = false,
    runFinished = false,
    runSuccess = false,
    casesStarted = 0,
    casesFinished = 0,
    attachmentBytes = 0,
    messageBytes = 0,
    evidenceError: string | undefined;
  let activeCase: TestCase | undefined, activeCaseStartedId: string | undefined;
  const onMessage = (message: Envelope) => {
    messageBytes += Buffer.byteLength(JSON.stringify(message));
    if (messageBytes > 8 * 1024 * 1024) throw new Error('BDD Cucumber messages exceed 8 MiB');
    if (message.testRunStarted) {
      if (runStarted) throw new Error('Duplicate Cucumber testRunStarted');
      runStarted = true;
    }
    if (message.pickle) pickles.set(message.pickle.id, message.pickle);
    if (message.hook) hookNames.set(message.hook.id, message.hook.name || 'Cucumber hook');
    if (message.testCase) cases.set(message.testCase.id, message.testCase);
    if (message.testCaseStarted) {
      casesStarted++;
      activeCase = cases.get(message.testCaseStarted.testCaseId);
      activeCaseStartedId = message.testCaseStarted.id;
      if (casesStarted !== 1 || !activeCase)
        throw new Error('Cucumber executed an unauthorized scenario');
    }
    if (message.testCaseFinished) {
      if (message.testCaseFinished.testCaseStartedId !== activeCaseStartedId)
        throw new Error('Cucumber scenario identity mismatch');
      casesFinished++;
    }
    if (message.attachment) {
      attachmentBytes +=
        message.attachment.contentEncoding === 'BASE64'
          ? Buffer.byteLength(message.attachment.body, 'base64')
          : Buffer.byteLength(message.attachment.body);
      if (attachmentBytes > 1024 * 1024) {
        evidenceError = 'BDD attachments exceed 1 MiB';
        throw new Error(evidenceError);
      }
      if (/^text\/plain(?:;|$)/i.test(message.attachment.mediaType)) {
        if (attachments.length >= 100) {
          evidenceError = 'BDD attachments exceed 100 items';
          throw new Error(evidenceError);
        }
        attachments.push({
          mediaType: 'text/plain',
          text:
            message.attachment.contentEncoding === 'BASE64'
              ? Buffer.from(message.attachment.body, 'base64').toString('utf8')
              : message.attachment.body,
        });
      }
    }
    if (message.testStepFinished) {
      const finished = message.testStepFinished;
      if (!activeCase || finished.testCaseStartedId !== activeCaseStartedId)
        throw new Error('Cucumber step identity mismatch');
      const testStep = activeCase.testSteps.find((step) => step.id === finished.testStepId);
      if (!testStep) throw new Error('Unknown Cucumber step');
      const pickleStep = pickles
        .get(activeCase.pickleId)
        ?.steps.find((step) => step.id === testStep.pickleStepId);
      const duration = finished.testStepResult.duration;
      steps.push({
        kind: testStep.hookId ? 'hook' : 'step',
        name: pickleStep?.text ?? hookNames.get(testStep.hookId ?? '') ?? 'Cucumber hook',
        status: finished.testStepResult.status,
        durationMs: Number(duration.seconds) * 1000 + duration.nanos / 1000000,
        ...(finished.testStepResult.message
          ? { error: finished.testStepResult.message.slice(0, 256 * 1024) }
          : {}),
      });
      if (steps.length > 100000) throw new Error('BDD step result limit exceeded');
    }
    if (message.testRunFinished) {
      if (runFinished) throw new Error('Duplicate Cucumber testRunFinished');
      runFinished = true;
      runSuccess = message.testRunFinished.success;
    }
  };
  const execution = await api.runCucumber(runConfiguration, environment, onMessage);
  if (
    !runStarted ||
    !runFinished ||
    casesStarted !== 1 ||
    casesFinished !== 1 ||
    !steps.some((step) => step.kind === 'step')
  )
    throw new Error('Incomplete Cucumber terminal events');
  const result = BddAgentResultSchema.parse({
    status:
      !evidenceError &&
      execution.success &&
      runSuccess &&
      steps.every((step) => step.status === 'PASSED')
        ? 'passed'
        : 'failed',
    durationMs: Date.now() - started,
    steps,
    ...(attachments.length ? { attachments } : {}),
    ...(evidenceError ? { error: evidenceError } : {}),
  });
  output.end(JSON.stringify({ complete: true, result }));
}
main().catch((error) => {
  output.end(
    JSON.stringify({
      complete: false,
      result: {
        status: 'failed',
        durationMs: Date.now() - started,
        steps: [],
        error: String(error instanceof Error ? error.message : 'Cucumber execution failed').slice(
          0,
          256 * 1024,
        ),
      },
    }),
  );
  process.exitCode = 1;
});
