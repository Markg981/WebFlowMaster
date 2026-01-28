import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/components/ui/use-toast";
import { ExcelTestCase } from './useExcelImport';

export function useTestRunner(
    parsedTestCases: ExcelTestCase[], 
    localMappings: Record<string, number>
) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const executeTestMutation = useMutation({
     mutationFn: async (payload: any) => {
        return await apiRequest('POST', '/api/execute-excel-test', payload);
     }
  });

  const runSelected = async () => {
    setReportUrl(null); // Reset prev report
    let hasExecution = false;
    for (const excelId of Array.from(selectedIds)) {
       const testId = localMappings[excelId];
       if (!testId) {
         toast({ title: "Skipping", description: `No mapping for ${excelId}`, variant: "destructive" });
         continue;
       }
       const testCase = parsedTestCases.find(tc => tc.testCaseId === excelId);
       
       try {
           await executeTestMutation.mutateAsync({
               excelId,
               testId,
               metadata: {
                   name: testCase?.functionalObjective || "Excel Test",
                   priority: testCase?.priority,
                   devOpsId: testCase?.devOpsId,
                   sme: testCase?.sme,
                   environment: "Staging" 
               }
           });
           toast({ title: "Executed", description: `Test ${excelId} finished.` });
           hasExecution = true;
       } catch (e) {
           toast({ title: "Failed", description: `Test ${excelId} failed to execute.`, variant: "destructive" });
       }
    }

    if (hasExecution) {
        // Trigger report generation
        try {
            const res = await apiRequest('POST', '/api/reports/generate', {});
            const data = await res.json();
            if (data.url) {
                setReportUrl(data.url);
                toast({ title: "Report Ready", description: "Allure report generated successfully." });
            }
        } catch (e) {
            toast({ title: "Report Error", description: "Failed to generate report.", variant: "destructive" });
        }
    }
  };

  return { selectedIds, reportUrl, toggleSelection, runSelected };
}
