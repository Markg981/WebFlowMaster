import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOWNLOAD_COLS,
  DEFAULT_DOWNLOAD_ROWS,
  applyMask,
  downloadCheckpointProblem,
  parseDownloadCheckpointValue,
  splitDownloadCheckpointValue,
} from './download-checkpoint';
import { AdhocTestStepSchema } from './schema';

const step = (value: string | undefined, selector: string | undefined = '#export') => ({
  id: 's1',
  action: {
    id: 'checkpointDownload',
    type: 'checkpointDownload',
    name: 'Checkpoint download',
    icon: 'FileSpreadsheet',
    description: '',
  },
  ...(selector
    ? {
        targetElement: {
          id: 'e1',
          type: 'button',
          tag: 'button',
          attributes: {},
          text: 'Export',
          selector,
        },
      }
    : {}),
  ...(value !== undefined ? { value } : {}),
});

describe('parseDownloadCheckpointValue', () => {
  it('reads a bare name with the default bounds', () => {
    expect(parseDownloadCheckpointValue(' aggregated ')).toEqual({
      name: 'aggregated',
      rows: DEFAULT_DOWNLOAD_ROWS,
      cols: DEFAULT_DOWNLOAD_COLS,
    });
  });

  it('reads the bounds and both masks; the content mask may hold a | of its own', () => {
    const value = parseDownloadCheckpointValue(
      'summary; rows=1000; cols=20 | _\\d{8}_\\d{6} | \\d{2}/\\d{2}/\\d{4}|\\d{2}:\\d{2}',
    );
    if ('error' in value) throw new Error(value.error);
    expect(value).toMatchObject({ name: 'summary', rows: 1000, cols: 20 });
    expect(applyMask('batch_20260307_140509.xlsx', value.fileMask)).toBe('batch<masked>.xlsx');
    expect(applyMask('Printed 07/03/2026 at 14:05', value.contentMask)).toBe(
      'Printed <masked> at <masked>',
    );
    // The same mask twice in a row: a global regex must not resume where it stopped.
    expect(applyMask('07/03/2026', value.contentMask)).toBe('<masked>');
  });

  it('takes a content mask without a file-name mask', () => {
    const value = parseDownloadCheckpointValue('pdf | | Page \\d+');
    if ('error' in value) throw new Error(value.error);
    expect(value.fileMask).toBeUndefined();
    expect(value.contentMask?.source).toBe('Page \\d+');
  });

  it.each([
    ['', 'the name of the checkpoint comes first'],
    ['x; rows=0', 'rows must be between 1 and 5000'],
    ['x; cols=501', 'cols must be between 1 and 500'],
    ['x; sheets=2', '"sheets=2" is not rows=<number> or cols=<number>'],
    ['x | (', 'the file-name mask is not a regular expression'],
    ['x | a |', 'the content mask after the second | is empty'],
  ])('refuses %j', (raw, error) => {
    const value = parseDownloadCheckpointValue(raw);
    expect('error' in value && value.error).toContain(error);
  });
});

describe('checkpointDownload step validation', () => {
  it('accepts a step with a target and a valid value', () => {
    expect(AdhocTestStepSchema.safeParse(step('summary; rows=10 | \\d+')).success).toBe(true);
    expect(downloadCheckpointProblem([step('summary')])).toBeNull();
  });

  it('refuses a step without a target, without a value or with a malformed value', () => {
    expect(AdhocTestStepSchema.safeParse(step('summary', '')).success).toBe(false);
    expect(AdhocTestStepSchema.safeParse(step(undefined)).success).toBe(false);
    const broken = AdhocTestStepSchema.safeParse(step('summary; rows=0'));
    expect(broken.success).toBe(false);
    expect(broken.error?.issues[0]).toMatchObject({ path: ['value'] });
    expect(broken.error?.issues[0].message).toContain('rows must be between');
    expect(
      AdhocTestStepSchema.safeParse(step(`summary | ${'a'.repeat(501)}`)).error?.issues[0].message,
    ).toContain('longer than 500');
  });

  it('leaves the masks uncompiled when it only checks a value: the run reports a bad one', () => {
    expect(splitDownloadCheckpointValue('x | (unclosed | \\d+')).toEqual({
      name: 'x',
      rows: 500,
      cols: 50,
      fileMask: '(unclosed',
      contentMask: '\\d+',
    });
    expect(AdhocTestStepSchema.safeParse(step('summary | (unclosed')).success).toBe(true);
  });

  it('explains the first wrong step of a sequence, as the API reports it', () => {
    expect(downloadCheckpointProblem([{ action: { id: 'click' } }, step('summary', '')])).toBe(
      'Step 2: checkpointDownload needs the element whose click downloads the file.',
    );
    expect(downloadCheckpointProblem([step('x; rows=abc')])).toBe(
      'Step 1: checkpointDownload value: "rows=abc" is not rows=<number> or cols=<number>.',
    );
    expect(downloadCheckpointProblem(undefined)).toBeNull();
  });
});
