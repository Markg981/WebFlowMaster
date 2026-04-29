import { useQuery } from '@tanstack/react-query';

export interface TestSequence {
  id: number;
  name: string;
}

export function useTestSequences() {
  const { data: sequences = [], isLoading, error } = useQuery<TestSequence[]>({
    queryKey: ['/api/tests'],
    initialData: [],
  });

  return { sequences, isLoading, error };
}
