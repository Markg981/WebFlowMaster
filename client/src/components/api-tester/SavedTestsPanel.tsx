import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiTest } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Edit2, Trash2, PlusCircle, Download, ChevronRight } from 'lucide-react';

interface SavedTestsPanelProps {
  savedTests: ApiTest[];
  onLoadTest: (test: ApiTest) => void;
  onEditTest: (test: ApiTest) => void;
  onDeleteTest: (testId: number) => void;
  onExportTest: (test: ApiTest) => void;
  onOpenSaveModal: () => void;
  isLoading?: boolean;
  isDeletingTestId?: number | null;
}

interface Project {
  id: number;
  name: string;
}

const NO_PROJECT = -1; // sentinel bucket for tests with no projectId
const OTHER_MODULE = 'Other';

export const SavedTestsPanel: React.FC<SavedTestsPanelProps> = ({
  savedTests,
  onLoadTest,
  onEditTest,
  onDeleteTest,
  onExportTest,
  onOpenSaveModal,
  isLoading,
  isDeletingTestId,
}) => {
  const { t } = useTranslation();

  // Fetch project names so tests can be grouped under a readable project header.
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects'] });
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  // Group: project -> module -> tests.
  const byProject = new Map<number, Map<string, ApiTest[]>>();
  for (const test of savedTests) {
    const pid = test.projectId ?? NO_PROJECT;
    const mod = test.module || OTHER_MODULE;
    if (!byProject.has(pid)) byProject.set(pid, new Map());
    const modules = byProject.get(pid)!;
    if (!modules.has(mod)) modules.set(mod, []);
    modules.get(mod)!.push(test);
  }

  const projectLabel = (pid: number) =>
    pid === NO_PROJECT
      ? t('apiTester.savedTestsPanel.noProject.label', 'No project')
      : projectNameById.get(pid) ?? `Project ${pid}`;

  const sortedProjectIds = Array.from(byProject.keys()).sort((a, b) =>
    projectLabel(a).localeCompare(projectLabel(b)),
  );

  // Each project is a collapsible group: click the project name to reveal its tests.
  // The first project starts open so the panel isn't empty on load; the rest start closed.
  const [openState, setOpenState] = useState<Record<number, boolean>>({});
  const isOpen = (pid: number, index: number) => openState[pid] ?? index === 0;
  const toggleProject = (pid: number, index: number) =>
    setOpenState((prev) => ({ ...prev, [pid]: !(prev[pid] ?? index === 0) }));

  // The row itself loads the test: clicking a card is the obvious gesture, and in a narrow
  // sidebar the action icons are the first thing to be squeezed out of sight.
  const renderRow = (test: ApiTest) => (
    <div
      key={test.id}
      role="button"
      tabIndex={0}
      onClick={() => onLoadTest(test)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLoadTest(test);
        }
      }}
      title={t('apiTester.savedTestsPanel.loadTest.button')}
      className="w-full p-3 border rounded-md hover:bg-muted/50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="font-mono text-xs py-0.5 px-1.5 shrink-0">
              {test.method}
            </Badge>
            <span className="text-sm font-semibold truncate" title={test.name}>
              {test.name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate" title={test.url}>
            {test.url}
          </p>
          <div className="text-xs text-muted-foreground mt-1">
            {t('apiTester.savedTestsPanel.lastUpdated.label')} {new Date(test.updatedAt).toLocaleDateString()}
          </div>
        </div>
        {/* Icons sit inside the clickable card, so each stops the click from also loading it. */}
        <div className="flex items-center shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onEditTest(test); }}
            title={t('apiTester.savedTestsPanel.editTest.button')} disabled={isLoading || !!isDeletingTestId}>
            <Edit2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onExportTest(test); }}
            title={t('apiTester.savedTestsPanel.exportTest.button')} disabled={isLoading || !!isDeletingTestId}>
            <Download className="h-4 w-4 text-sky-500" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onDeleteTest(test.id); }}
            title={t('apiTester.savedTestsPanel.deleteTest.button')} disabled={isLoading || isDeletingTestId === test.id}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b">
        <CardTitle className="text-lg">{t('apiTester.savedTestsPanel.savedTests.title')}</CardTitle>
        <Button variant="outline" size="sm" onClick={onOpenSaveModal} disabled={isLoading}>
          <PlusCircle className="mr-2 h-4 w-4" /> {t('apiTester.savedTestsPanel.newTest.button')}
        </Button>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        <ScrollArea className="h-full p-3">
          {isLoading && <p className="text-sm text-muted-foreground">{t('apiTester.savedTestsPanel.loadingSavedTests.text')}</p>}
          {!isLoading && savedTests.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">{t('apiTester.savedTestsPanel.noTestsSavedYet.text')}</p>
          )}

          <div className="space-y-2">
            {sortedProjectIds.map((pid, index) => {
              const modules = byProject.get(pid)!;
              const count = Array.from(modules.values()).reduce((n, arr) => n + arr.length, 0);
              const sortedModules = Array.from(modules.keys()).sort((a, b) => a.localeCompare(b));
              const open = isOpen(pid, index);
              return (
                <div key={pid} className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => toggleProject(pid, index)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <ChevronRight
                      className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                    />
                    <span className="flex-1 truncate text-sm font-semibold">{projectLabel(pid)}</span>
                    <Badge variant="secondary" className="font-mono text-[11px] tabular-nums">{count}</Badge>
                  </button>
                  {open && (
                    <div className="space-y-3 px-2 pb-3 pt-1">
                      {sortedModules.map((mod) => (
                        <div key={mod}>
                          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {mod} <span className="font-normal text-muted-foreground/70">({modules.get(mod)!.length})</span>
                          </div>
                          <div className="space-y-2">
                            {modules.get(mod)!.map(renderRow)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
