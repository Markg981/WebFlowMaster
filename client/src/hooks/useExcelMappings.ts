import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/components/ui/use-toast";

export interface Mapping {
  id?: number;
  excelTestCaseId: string;
  testId: number;
}

export function useExcelMappings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Fetch Mappings
  const { data: mappings = [] } = useQuery<Mapping[]>({
    queryKey: ['/api/excel-mappings'],
    initialData: [],
  });

  // Local state for fast UI updates
  const [localMappings, setLocalMappings] = useState<Record<string, number>>({});

  useEffect(() => {
    if (mappings) {
      const map: Record<string, number> = {};
      mappings.forEach(m => {
        map[m.excelTestCaseId] = m.testId;
      });
      setLocalMappings(prev => ({ ...prev, ...map }));
    }
  }, [mappings]);

  // Save mapping mutation
  const saveMappingMutation = useMutation({
    mutationFn: async ({ excelId, testId }: { excelId: string, testId: number }) => {
      await apiRequest('POST', '/api/excel-mappings', { excelTestCaseId: excelId, testId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/excel-mappings'] });
      toast({ title: "Mapping Saved" });
    }
  });

  const handleMappingChange = (excelId: string, testIdStr: string) => {
    const testId = parseInt(testIdStr);
    setLocalMappings(prev => ({ ...prev, [excelId]: testId }));
    saveMappingMutation.mutate({ excelId, testId });
  };

  return { localMappings, handleMappingChange };
}
