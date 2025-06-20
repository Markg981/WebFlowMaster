import React from 'react';
import { ApiTest } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit2, Trash2, PlayCircle, PlusCircle, Download } from 'lucide-react'; // Added Download icon

interface SavedTestsPanelProps {
  savedTests: ApiTest[];
  onLoadTest: (test: ApiTest) => void;
  onEditTest: (test: ApiTest) => void;
  onDeleteTest: (testId: number) => void;
  onExportTest: (test: ApiTest) => void; // New prop for export
  onOpenSaveModal: () => void;
  isLoading?: boolean;
  isDeletingTestId?: number | null;
}

export const SavedTestsPanel: React.FC<SavedTestsPanelProps> = ({
  savedTests,
  onLoadTest,
  onEditTest,
  onDeleteTest,
  onExportTest, // Destructure new prop
  onOpenSaveModal,
  isLoading,
  isDeletingTestId,
}) => {
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
            {savedTests.map((test) => (
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onLoadTest(test)}
                      title={t('apiTester.savedTestsPanel.loadTest.button')}
                      disabled={isLoading || !!isDeletingTestId}
                    >
                      <PlayCircle className="h-4 w-4 text-blue-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditTest(test)}
                      title={t('apiTester.savedTestsPanel.editTest.button')}
                      disabled={isLoading || !!isDeletingTestId}
                    >
                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onExportTest(test)} // Call onExportTest
                      title={t('apiTester.savedTestsPanel.exportTest.button')}
                      disabled={isLoading || !!isDeletingTestId}
                    >
                      <Download className="h-4 w-4 text-sky-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteTest(test.id)}
                      title={t('apiTester.savedTestsPanel.deleteTest.button')}
                      disabled={isLoading || isDeletingTestId === test.id}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                 {test.projectId && (
                    <div className="text-xs text-muted-foreground mt-1">
                        {t('apiTester.savedTestsPanel.projectId.label')} {test.projectId} {/* Enhance with project name later if needed */}
                    </div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {t('apiTester.savedTestsPanel.lastUpdated.label')} {new Date(test.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
