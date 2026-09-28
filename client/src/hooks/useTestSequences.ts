import { useQuery } from '@tanstack/react-query';

export interface TestSequence {
  id: number;
  name: string;
}

/** One array for "not loaded yet", so consumers that depend on the list see a stable value. */
const NO_SEQUENCES: TestSequence[] = [];

export function useTestSequences() {
  // No initialData: with the client's staleTime of Infinity, an initial [] counts as fresh
  // data, the list is never fetched, and the sequence picker opens empty.
  const { data: sequences = NO_SEQUENCES, isLoading, error } = useQuery<TestSequence[]>({
    queryKey: ['/api/tests'],
  });

  return { sequences, isLoading, error };
}
