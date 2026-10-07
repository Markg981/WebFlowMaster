/** Only observed runtime values belong in `effective`; requests are never copied there. */
export interface MatrixConfiguration {
  browser?: string | null;
  browserVersion?: string | null;
  os?: string | null;
  osVersion?: string | null;
  device?: string | null;
}

export interface MatrixEvidence {
  version: 1;
  route: 'local' | 'agent' | 'grid' | 'appium';
  provider?: string;
  sessionId?: string;
  requested: MatrixConfiguration;
  effective: MatrixConfiguration;
  observedAt: string;
  source: 'runtime' | 'provider' | 'capabilities' | 'unavailable';
  verdict: 'matched' | 'mismatch' | 'unverified';
  differences: string[];
}

function normalized(key: string, value: string): string {
  const text = value.trim().toLowerCase();
  if (key === 'os') {
    if (['darwin', 'macos', 'mac os', 'os x'].includes(text)) return 'macos';
    if (['win32', 'windows'].includes(text)) return 'windows';
  }
  if (key === 'browser') return text.replace(/^(?:playwright|pw)-/, '').replace(/^(?:msedge|microsoft edge)$/, 'edge');
  return text;
}

export function matrixEvidence(
  input: Omit<MatrixEvidence, 'version' | 'observedAt' | 'verdict' | 'differences'>,
): MatrixEvidence {
  const differences: string[] = [];
  let unknown = input.source === 'unavailable';
  for (const key of Object.keys(input.requested) as (keyof MatrixConfiguration)[]) {
    const wanted = input.requested[key];
    if (!wanted || wanted.toLowerCase() === 'latest') continue;
    const actual = input.effective[key];
    if (!actual) {
      unknown = true;
      differences.push(`${key}: requested ${wanted}; effective value unavailable`);
      continue;
    }
    const w = normalized(key, wanted),
      a = normalized(key, actual);
    // A requested major/minor version accepts its patch releases, never another major.
    const matches =
      w === a || (key.endsWith('Version') && /^\d+(\.\d+)*$/.test(w) && a.startsWith(`${w}.`));
    if (!matches) differences.push(`${key}: requested ${wanted}; effective ${actual}`);
  }
  const mismatch = differences.some((d) => !d.endsWith('effective value unavailable'));
  return {
    ...input,
    version: 1,
    observedAt: new Date().toISOString(),
    verdict: mismatch ? 'mismatch' : unknown ? 'unverified' : 'matched',
    differences,
  };
}

/** Supports legacy web arrays and native mobile logs. No legacy evidence means no certification. */
export function readMatrixEvidence(log: string | null | undefined): MatrixEvidence[] {
  if (!log) return [];
  try {
    const parsed = JSON.parse(log);
    const entries = Array.isArray(parsed)
      ? parsed.map((s) => s?.matrixEvidence)
      : [parsed?.matrixEvidence];
    return entries.filter(
      (e): e is MatrixEvidence =>
        e?.version === 1 &&
        e.requested &&
        e.effective &&
        ['matched', 'mismatch', 'unverified'].includes(e.verdict) &&
        Array.isArray(e.differences),
    );
  } catch {
    return [];
  }
}
