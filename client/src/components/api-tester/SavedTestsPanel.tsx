import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiTest } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit2, Trash2, PlayCircle, PlusCircle, Download } from 'lucide-react';

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

  const renderRow = (test: ApiTest) => (
    <div key={test.id} className="p-3 border rounded-md hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="font-mono text-xs py-0.5 px-1.5">
              {test.method}
            </Badge>
            <span className="text-sm font-semibold truncate" title={test.name}>
              {test.name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate" title={test.url}>
            {test.url}
          </p>
        </div>
        <div className="flex items-center space-x-1 ml-2">
          <Button variant="ghost" size="icon" onClick={() => onLoadTest(test)}
            title={t('apiTester.savedTestsPanel.loadTest.button')} disabled={isLoading || !!isDeletingTestId}>
            <PlayCircle className="h-4 w-4 text-blue-500" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onEditTest(test)}
            title={t('apiTester.savedTestsPanel.editTest.button')} disabled={isLoading || !!isDeletingTestId}>
            <Edit2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onExportTest(test)}
            title={t('apiTester.savedTestsPanel.exportTest.button')} disabled={isLoading || !!isDeletingTestId}>
            <Download className="h-4 w-4 text-sky-500" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDeleteTest(test.id)}
            title={t('apiTester.savedTestsPanel.deleteTest.button')} disabled={isLoading || isDeletingTestId === test.id}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {t('apiTester.savedTestsPanel.lastUpdated.label')} {new Date(test.updatedAt).toLocaleDateString()}
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

          <div className="space-y-4">
            {sortedProjectIds.map((pid) => {
              const modules = byProject.get(pid)!;
              const count = Array.from(modules.values()).reduce((n, arr) => n + arr.length, 0);
              const sortedModules = Array.from(modules.keys()).sort((a, b) => a.localeCompare(b));
              return (
                <div key={pid}>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/95 py-1 z-10">
                    <span className="text-sm font-bold">{projectLabel(pid)}</span>
                    <Badge variant="outline" className="text-xs">{count}</Badge>
                  </div>
                  <div className="space-y-3 pl-1">
                    {sortedModules.map((mod) => (
                      <div key={mod}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                          {mod} <span className="font-normal">({modules.get(mod)!.length})</span>
                        </div>
                        <div className="space-y-2">
                          {modules.get(mod)!.map(renderRow)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
