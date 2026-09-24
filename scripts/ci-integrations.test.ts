import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { USAGE, parseArgs } from './wfm-cli';

/**
 * The CI integrations in integrations/: a GitHub Action, a GitLab template, a Jenkins library
 * step, an Azure Pipelines template. None of them can be run here, so what is held is what can
 * drift. Every option they pass is one the CLI takes; each downloads the CLI from the server
 * rather than expecting it installed; and the GitHub Action never interpolates an input into a
 * script, which is the difference between a string and a command.
 */

const root = path.resolve(__dirname, '..', 'integrations');
const files = [
  'github-action/action.yml',
  'gitlab/webflowmaster.gitlab-ci.yml',
  'jenkins/vars/webflowmaster.groovy',
  'azure-pipelines/webflowmaster.yml',
].map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));

describe('the CI integrations', () => {
  it('pass only options the CLI takes', () => {
    for (const { file, text } of files) {
      const flags = new Set(text.match(/(?<![\w-])--[a-z][a-z-]+/g) ?? []);
      // curl's own options, in the Action's download step.
      for (const curl of ['--retry', '--retry-delay']) flags.delete(curl);
      for (const flag of flags) {
        expect(USAGE, `${file} passes ${flag}`).toContain(flag);
      }
    }
  });

  it('parse, as the CLI reads them, into a run that waits and writes JUnit', () => {
    // The command line each integration builds, with its placeholders filled in.
    const parsed = parseArgs(['run', 'plan-1', '--wait', '--timeout', '1800', '--junit', 'j.xml', '--html', 'r.html', '--environment', '3'], {} as NodeJS.ProcessEnv);
    expect(parsed).toMatchObject({ command: 'run', wait: true, junitPath: 'j.xml', htmlPath: 'r.html', environmentId: 3 });
  });

  it('fetch the CLI from the server they talk to, instead of expecting it installed', () => {
    for (const { file, text } of files) {
      expect(text, file).toContain('/cli/wfm.mjs');
      expect(text, file).not.toMatch(/npx wfm|npm install -g/);
    }
  });

  it('GitHub Action: inputs reach its scripts through the environment only', () => {
    const action = files.find((f) => f.file.startsWith('github-action'))!.text;
    const lines = action.split(/\r?\n/);
    let runIndent: number | null = null;
    const interpolatedInRun: string[] = [];
    for (const line of lines) {
      const indent = line.length - line.trimStart().length;
      if (runIndent !== null && line.trim() !== '' && indent <= runIndent) runIndent = null;
      if (runIndent !== null && line.includes('${{')) interpolatedInRun.push(line.trim());
      if (/^\s*run: \|/.test(line)) runIndent = indent;
    }
    expect(interpolatedInRun).toEqual([]);
    expect(action).toContain('::add-mask::$WFM_API_KEY');
  });
});
