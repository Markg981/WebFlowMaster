/**
 * The value of a `checkpointDownload` step (server/runtime/download-checkpoint.ts):
 *
 *   name[; rows=N][; cols=N] [| file-name mask [| content mask]]
 *
 * The name pairs the checkpoint with the other run's. `rows` and `cols` bound what is kept of each
 * sheet. The file-name mask is a regular expression whose matches in the suggested file name are
 * replaced by `<masked>` (a timestamp the application stamps into it); the content mask, everything
 * after the second `|` (it may hold a `|` of its own), does the same in every cell and every line
 * of a PDF (a print date). With no file-name mask: `name | | content mask`.
 */

export const DEFAULT_DOWNLOAD_ROWS = 500;
export const DEFAULT_DOWNLOAD_COLS = 50;
export const MAX_DOWNLOAD_ROWS = 5000;
export const MAX_DOWNLOAD_COLS = 500;

/** What a mask leaves in place of what it matched. */
export const MASKED = '<masked>';

/** `A`, `B`, … `Z`, `AA`: the letters of a 1-based column. */
export function columnLetters(col: number): string {
  let out = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

export interface DownloadCheckpointValue {
  name: string;
  rows: number;
  cols: number;
  fileMask?: RegExp;
  contentMask?: RegExp;
}

function regexOf(source: string, which: string): RegExp | { error: string } {
  try {
    return new RegExp(source, 'g');
  } catch (err) {
    return { error: `the ${which} mask is not a regular expression (${(err as Error).message})` };
  }
}

export function parseDownloadCheckpointValue(
  raw: string,
): DownloadCheckpointValue | { error: string } {
  const at = raw.indexOf('|');
  const [head, ...options] = (at < 0 ? raw : raw.slice(0, at)).split(';');
  const name = head.trim();
  if (name === '') return { error: 'the name of the checkpoint comes first' };
  const value: DownloadCheckpointValue = {
    name,
    rows: DEFAULT_DOWNLOAD_ROWS,
    cols: DEFAULT_DOWNLOAD_COLS,
  };
  for (const option of options) {
    if (option.trim() === '') continue;
    const m = /^\s*(rows|cols)\s*=\s*(\d+)\s*$/i.exec(option);
    if (!m) return { error: `"${option.trim()}" is not rows=<number> or cols=<number>` };
    const n = Number(m[2]);
    const key = m[1].toLowerCase() as 'rows' | 'cols';
    const max = key === 'rows' ? MAX_DOWNLOAD_ROWS : MAX_DOWNLOAD_COLS;
    if (n < 1 || n > max) return { error: `${key} must be between 1 and ${max}` };
    value[key] = n;
  }
  if (at < 0) return value;
  const rest = raw.slice(at + 1);
  const maskAt = rest.indexOf('|');
  const fileSource = (maskAt < 0 ? rest : rest.slice(0, maskAt)).trim();
  if (fileSource !== '') {
    const re = regexOf(fileSource, 'file-name');
    if ('error' in re) return re;
    value.fileMask = re;
  }
  if (maskAt >= 0) {
    const contentSource = rest.slice(maskAt + 1).trim();
    if (contentSource === '') return { error: 'the content mask after the second | is empty' };
    const re = regexOf(contentSource, 'content');
    if ('error' in re) return re;
    value.contentMask = re;
  }
  return value;
}

/** A text with what the mask matches replaced by MASKED; the text itself without a mask. */
export function applyMask(text: string, mask: RegExp | undefined): string {
  if (!mask) return text;
  mask.lastIndex = 0;
  return text.replace(mask, MASKED);
}

/**
 * What is wrong with the first `checkpointDownload` step of a sequence, for the API that saves a
 * test: its value must parse and it needs the element whose click downloads the file.
 */
export function downloadCheckpointProblem(sequence: unknown): string | null {
  if (!Array.isArray(sequence)) return null;
  for (const [index, step] of sequence.entries()) {
    if (!step || typeof step !== 'object') continue;
    const s = step as { action?: { id?: unknown }; value?: unknown; targetElement?: unknown };
    if (s.action?.id !== 'checkpointDownload') continue;
    if (!s.targetElement)
      return `Step ${index + 1}: checkpointDownload needs the element whose click downloads the file.`;
    const parsed = parseDownloadCheckpointValue(typeof s.value === 'string' ? s.value : '');
    if ('error' in parsed) return `Step ${index + 1}: checkpointDownload value: ${parsed.error}.`;
  }
  return null;
}
