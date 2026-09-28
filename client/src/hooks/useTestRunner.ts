import { useState } from 'react';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/components/ui/use-toast";
import { ExcelTestCase } from './useExcelImport';

/** One step of a run, as POST /api/tests/:id/run reports it. */
export interface RunStep {
  name: string;
  type: string;
  status: 'passed' | 'failed';
  details?: string;
  error?: string;
  screenshot?: string;
}

export type RowStatus = 'running' | 'passed' | 'failed' | 'error' | 'notMapped';

/** What the Status column shows for an Excel row, and what its report opens on. */
export interface RowResult {
  status: RowStatus;
  testId?: number;
  steps?: RunStep[];
  error?: string;
  durationMs?: number;
}

export function useTestRunner(
    parsedTestCases: ExcelTestCase[],
    localMappings: Record<string, number>
) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [isRunning, setIsRunning] = useState(false);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const setResult = (excelId: string, result: RowResult) =>
    setResults((prev) => ({ ...prev, [excelId]: result }));

  // Runs the mapped sequence of each selected row, one after another, through the same
  // endpoint as a test started from the library. There used to be a call to
  // /api/execute-excel-test here, which the server never had: every run failed, and the
  // Status column had nothing to show.
  const runSelected = async () => {
    setIsRunning(true);
    // In table order rather than click order, so the rows fill in from the top.
    const rows = parsedTestCases.filter((tc) => selectedIds.has(tc.testCaseId));
    let passed = 0;
    let failed = 0;
    for (const tc of rows) {
      const excelId = tc.testCaseId;
      const testId = localMappings[excelId];
      if (!testId) {
        setResult(excelId, { status: 'notMapped' });
        continue;
      }
      setResult(excelId, { status: 'running', testId });
      try {
        const res = await apiRequest('POST', `/api/tests/${testId}/run`, {});
        const data = await res.json();
        const ok = Boolean(data.success);
        if (ok) passed++; else failed++;
        setResult(excelId, {
          status: ok ? 'passed' : 'failed',
          testId,
          steps: Array.isArray(data.steps) ? data.steps : [],
          error: data.error,
          durationMs: data.duration,
        });
      } catch (e) {
        failed++;
        setResult(excelId, { status: 'error', testId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setIsRunning(false);
    if (passed + failed > 0) {
      toast({
        title: failed === 0 ? "Run complete" : "Run complete with failures",
        description: `${passed} passed, ${failed} failed.`,
        variant: failed === 0 ? "default" : "destructive",
      });
    }
  };

  return { selectedIds, results, isRunning, toggleSelection, runSelected };
}
