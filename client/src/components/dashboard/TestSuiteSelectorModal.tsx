import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Loader2, Search } from 'lucide-react';

interface TagRef {
  id: string;
  name: string;
}

interface SelectableTest {
  id: number;
  name: string;
  type: 'ui' | 'api';
  description?: string | null;
  /** What the test is for, so a plan can be assembled by meaning instead of by remembering. */
  tags?: TagRef[];
}

interface TestSuiteSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTestSuites: (selectedSuites: SelectableTest[]) => void;
  alreadySelectedIds: string[]; // Array of "type-id" strings, e.g., ["ui-1", "api-2"]
}

const fetchSelectableTests = async (
  searchTerm: string = '',
  page: number = 1,
  limit: number = 20,
  tagIds: string[] = [],
): Promise<{items: SelectableTest[], totalItems: number, totalPages: number}> => {
  const params = new URLSearchParams({ search: searchTerm, page: String(page), limit: String(limit) });
  // Every tag, not any: two tags narrow the list to the tests that carry both.
  if (tagIds.length > 0) params.set('tags', tagIds.join(','));
  const response = await fetch(`/api/selectable-tests?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};

const fetchTags = async (): Promise<TagRef[]> => {
  const response = await fetch('/api/tags');
  if (!response.ok) throw new Error('Could not load tags');
  return response.json();
};

const TestSuiteSelectorModal: React.FC<TestSuiteSelectorModalProps> = ({ isOpen, onClose, onAddTestSuites, alreadySelectedIds }) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [internalSelectedSuites, setInternalSelectedSuites] = useState<SelectableTest[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const itemsPerPage = 10; // Or any other suitable limit

  const { data, isLoading, error, refetch } = useQuery<{items: SelectableTest[], totalItems: number, totalPages: number}>({
    queryKey: ['selectableTests', searchTerm, currentPage, activeTagIds],
    queryFn: () => fetchSelectableTests(searchTerm, currentPage, itemsPerPage, activeTagIds),
    enabled: isOpen, // Only fetch when the modal is open
    // keepPreviousData: true, // Consider this for smoother pagination UX
  });

  // The search box has always offered to find tests "by name or tag". Until tags existed it
  // could only ever do half of that.
  const { data: tagsData } = useQuery<TagRef[]>({
    queryKey: ['tags'],
    queryFn: fetchTags,
    enabled: isOpen,
  });
  const availableTags = Array.isArray(tagsData) ? tagsData : [];

  useEffect(() => {
    if (isOpen) {
      // Reset internal selections when modal opens, or pre-populate based on parent state if editing
      setInternalSelectedSuites([]);
      refetch(); // Refetch data when modal opens
    }
  }, [isOpen, refetch]);

  const handleToggleSuiteSelection = (suite: SelectableTest) => {
    setInternalSelectedSuites(prev =>
      prev.find(s => s.id === suite.id && s.type === suite.type)
        ? prev.filter(s => !(s.id === suite.id && s.type === suite.type))
        : [...prev, suite]
    );
  };

  const handleAdd = () => {
    onAddTestSuites(internalSelectedSuites);
    onClose();
  };

  const selectableItems = useMemo(() => {
    return data?.items?.filter(item => !alreadySelectedIds.includes(`${item.type}-${item.id}`)) || [];
  }, [data, alreadySelectedIds]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('testSuiteSelectorModal.title', 'Select Test Suites')}</DialogTitle>
          <DialogDescription>{t('testSuiteSelectorModal.description', 'Search and select the test suites to add to your test plan.')}</DialogDescription>
        </DialogHeader>

        <div className="relative mt-4 mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                type="search"
                placeholder={t('testSuiteSelectorModal.searchPlaceholder', 'Search by name or tag...')}
                className="pl-8 pr-2 py-2 h-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>

        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mb-2" data-testid="selector-tag-filters">
            {availableTags.map((tag) => (
              <Badge
                key={tag.id}
                role="button"
                className="cursor-pointer"
                variant={activeTagIds.includes(tag.id) ? 'default' : 'outline'}
                onClick={() => {
                  setCurrentPage(1);
                  setActiveTagIds((current) =>
                    current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id],
                  );
                }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        <ScrollArea className="flex-grow border rounded-md">
          <div className="p-4 space-y-2">
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2">{t('testSuiteSelectorModal.loading', 'Loading tests...')}</span>
              </div>
            )}
            {error && <p className="text-destructive">{t('testSuiteSelectorModal.error', 'Error loading tests:')} {error.message}</p>}
            {!isLoading && !error && selectableItems.length === 0 && (
              <p className="text-muted-foreground text-center py-4">{t('testSuiteSelectorModal.noTestsFound', 'No tests found or all available tests are already selected.')}</p>
            )}
            {!isLoading && !error && selectableItems.map((suite) => (
              <div key={`${suite.type}-${suite.id}`} className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-md">
                <Checkbox
                  id={`suite-${suite.type}-${suite.id}`}
                  checked={internalSelectedSuites.some(s => s.id === suite.id && s.type === suite.type)}
                  onCheckedChange={() => handleToggleSuiteSelection(suite)}
                />
                <label htmlFor={`suite-${suite.type}-${suite.id}`} className="flex-grow text-sm font-medium leading-none cursor-pointer">
                  {suite.name}
                  <span className="ml-2 text-xs uppercase bg-accent px-1.5 py-0.5 rounded-sm text-accent-foreground">{suite.type}</span>
                  {(suite.tags ?? []).map((tag) => (
                    <Badge key={tag.id} variant="secondary" className="ml-1 font-normal">
                      {tag.name}
                    </Badge>
                  ))}
                  {suite.description && <p className="text-xs text-muted-foreground mt-0.5">{suite.description}</p>}
                </label>
              </div>
            ))}
          </div>
        </ScrollArea>

         {data && data.totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 mt-3 mb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1 || isLoading}
              >
                {t('testSuiteSelectorModal.pagination.previous', 'Previous')}
              </Button>
              <span className="text-sm">
                {t('testSuiteSelectorModal.pagination.page', 'Page')} {currentPage} {t('testSuiteSelectorModal.pagination.of', 'of')} {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(data.totalPages, prev + 1))}
                disabled={currentPage === data.totalPages || isLoading}
              >
                {t('testSuiteSelectorModal.pagination.next', 'Next')}
              </Button>
            </div>
          )}

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">{t('testSuiteSelectorModal.cancel', 'Cancel')}</Button>
          </DialogClose>
          <Button onClick={handleAdd} disabled={internalSelectedSuites.length === 0}>
            {t('testSuiteSelectorModal.addSelected', 'Add Selected')} ({internalSelectedSuites.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TestSuiteSelectorModal;
