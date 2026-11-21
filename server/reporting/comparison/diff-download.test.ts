import { describe, expect, it } from 'vitest';
import { comparisonPolicyOf, type DownloadCheckpointData } from '@shared/comparison';
import { diffDownload } from './diff-download';
import { stepsWith } from './test-fixtures';
import { testVerdict } from './verdict';

const policy = comparisonPolicyOf({});
const paths = (d: { path: string }[]) => d.map((x) => x.path);

const file = (data: Partial<DownloadCheckpointData>, name = 'aggregated-xlsx') =>
  stepsWith('download', {
    name,
    data: { fileName: 'batch.xlsx', type: 'xlsx', extension: 'xlsx', size: 1000, ...data },
  });

const sheet = (name: string, range: string, rows: string[][], merges: string[] = []) => ({
  name,
  range,
  rows,
  merges,
});

describe('diffDownload', () => {
  it('finds nothing when only the size differs, nor between cells equal under the policy', () => {
    const rows = [['Total', '1,234.50']];
    expect(
      diffDownload(
        file({ size: 1000, sheets: [sheet('S', 'A1:B1', rows)] }),
        file({ size: 1200, sheets: [sheet('S', 'A1:B1', [['Total ', '1,234.50']])] }),
        policy,
      ),
    ).toEqual([]);
  });

  it('names each differing cell after the sheet and the Excel address', () => {
    const d = diffDownload(
      file({
        sheets: [
          sheet(
            'Summary',
            'B2:C4',
            [
              ['Batch', ''],
              ['Total', '10'],
              ['Avg', '5'],
            ],
            ['B2:C2'],
          ),
          sheet('Detail', 'A1:A1', [['x']]),
        ],
      }),
      file({
        sheets: [
          sheet('Summary', 'B2:C3', [
            ['Batch', ''],
            ['Total', '11'],
          ]),
          sheet('Checks', 'A1:A1', [['y']]),
        ],
      }),
      policy,
    );
    expect(paths(d)).toEqual([
      'sheets',
      'sheets[Summary].range',
      'sheets[Summary].merges',
      'sheets[Summary]!C3',
      'sheets[Summary]!4:4',
      'sheets[Detail]',
      'sheets[Checks]',
    ]);
    expect(d.find((x) => x.path === 'sheets[Summary]!C3')).toMatchObject({
      kind: 'download',
      checkpoint: 'aggregated-xlsx',
      severity: 'blocking',
      baseline: '10',
      candidate: '11',
    });
    expect(d[0]).toMatchObject({
      baseline: ['Summary', 'Detail'],
      candidate: ['Summary', 'Checks'],
    });
  });

  it('pairs the lines of a PDF page, so a line one side adds does not shift the rest', () => {
    const pdf = (pages: string[][]) =>
      file({
        fileName: 'batch.pdf',
        type: 'pdf',
        extension: 'pdf',
        pageCount: pages.length,
        pages,
      });
    const d = diffDownload(
      pdf([['Batch Summary', 'Plant A', 'Total 10', 'End'], ['Page 2']]),
      pdf([['Batch Summary', 'Note', 'Plant A', 'Total 11', 'End'], ['Page 2'], ['Page 3']]),
      policy,
    );
    expect(d.map((x) => [x.path, x.baseline, x.candidate])).toEqual([
      ['pageCount', 2, 3],
      ['pages[1].lines[2]', null, 'Note'],
      ['pages[1].lines[3]', 'Total 10', 'Total 11'],
      ['pages[3]', null, ['Page 3']],
    ]);
  });

  it('compares the file name, the kind of file and the hash of an unread file', () => {
    expect(
      paths(
        diffDownload(
          file({ fileName: 'a.zip', type: 'other', sha256: 'aa' }),
          file({ fileName: 'b.zip', type: 'other', sha256: 'bb' }),
          policy,
        ),
      ),
    ).toEqual(['fileName', 'sha256']);
    expect(
      paths(diffDownload(file({ type: 'xlsx', sheets: [] }), file({ type: 'csv' }), policy)),
    ).toEqual(['type']);
  });

  it('shows a checkpoint on one side only by its file, and makes the verdict different', () => {
    const d = diffDownload(
      file({ sheets: [sheet('S', 'A1:A1', [['x']])] }),
      stepsWith('download'),
      policy,
    );
    expect(d).toEqual([
      expect.objectContaining({
        path: '',
        baseline: { fileName: 'batch.xlsx', type: 'xlsx', sheets: ['S'] },
        candidate: null,
      }),
    ]);
    expect(testVerdict('Passed', 'Passed', d)).toBe('different');
  });
});
