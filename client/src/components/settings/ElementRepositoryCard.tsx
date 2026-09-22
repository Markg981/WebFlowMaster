import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crosshair, Loader2, Save, Trash2 } from 'lucide-react';

/**
 * Curating the elements of one application.
 *
 * This is where a selector is corrected once instead of in every test that copied it, and
 * where the healing pass's repairs show up — a list of what the application has been moving
 * underneath the suite.
 */

interface Project {
  id: number;
  name: string;
}

interface ProjectElement {
  id: string;
  name: string;
  selector: string;
  originalSelector: string | null;
  frameSelector: string | null;
  healedAt: string | null;
  updatedAt: string;
}

const ElementRepositoryCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const { data: projects = [] } = useQuery<Project[], Error>({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Could not load projects');
      return response.json();
    },
  });

  const { data: elements = [], isLoading } = useQuery<ProjectElement[], Error>({
    queryKey: ['projectElements', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/elements`);
      if (!response.ok) throw new Error('Could not load the elements');
      return response.json();
    },
    enabled: projectId !== '',
  });

  const saveSelector = useMutation({
    mutationFn: async ({ id, selector }: { id: string; selector: string }) => {
      const response = await fetch(`/api/project-elements/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not update the element');
      }
      return response.json();
    },
    onSuccess: (_result, variables) => {
      setEdited((previous) => {
        const next = { ...previous };
        delete next[variables.id];
        return next;
      });
      setMessage({
        kind: 'info',
        text: t('settings.elements.updated', 'Updated. Every test that uses it will run against the new selector.'),
      });
      queryClient.invalidateQueries({ queryKey: ['projectElements', projectId] });
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });

  const deleteElement = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/project-elements/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // The server refuses while tests still name it, and says which — worth repeating.
        const used = Array.isArray(body.tests) && body.tests.length > 0 ? ` (${body.tests.join(', ')})` : '';
        throw new Error(`${body.error || 'Could not delete the element'}${used}`);
      }
      return response.json();
    },
    onSuccess: () => {
      setMessage(null);
      queryClient.invalidateQueries({ queryKey: ['projectElements', projectId] });
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeElements = Array.isArray(elements) ? elements : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Crosshair className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.elements.title', 'Element repository')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.elements.description',
            'One definition per element, per application. A test that uses one reads its selector from here, so a correction reaches every test at once.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="w-full sm:w-72">
          <Label htmlFor="elementRepositoryProject">{t('settings.elements.projectLabel', 'Project')}</Label>
          <Select value={projectId} onValueChange={(value) => { setProjectId(value); setMessage(null); }}>
            <SelectTrigger id="elementRepositoryProject" className="mt-1">
              <SelectValue placeholder={t('settings.elements.projectPlaceholder', 'Choose a project')} />
            </SelectTrigger>
            <SelectContent>
              {safeProjects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {message && (
          <p className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {message.text}
          </p>
        )}

        {projectId === '' ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.elements.chooseProject', 'Choose a project to see the elements it owns.')}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.elements.loading', 'Loading elements…')}</p>
        ) : safeElements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.elements.empty',
              'Nothing kept yet. In the builder, use the bookmark on a detected element to keep it here.',
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.elements.columns.name', 'Name')}</TableHead>
                  <TableHead className="min-w-[280px]">{t('settings.elements.columns.selector', 'Selector')}</TableHead>
                  <TableHead>{t('settings.elements.columns.state', 'State')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {safeElements.map((element) => {
                  const draft = edited[element.id] ?? element.selector;
                  const isDirty = draft !== element.selector;
                  return (
                    <TableRow key={element.id}>
                      <TableCell className="font-medium align-top">
                        {element.name}
                        {element.frameSelector && (
                          <div className="text-xs text-muted-foreground">
                            {t('settings.elements.inFrame', 'in frame')}: {element.frameSelector}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          value={draft}
                          onChange={(e) => setEdited((previous) => ({ ...previous, [element.id]: e.target.value }))}
                          className="font-mono text-xs"
                          aria-label={t('settings.elements.selectorFor', 'Selector for {{name}}', { name: element.name })}
                        />
                        {element.originalSelector && element.originalSelector !== element.selector && (
                          <div className="text-xs text-muted-foreground mt-1 break-all">
                            {t('settings.elements.was', 'was')}: <code>{element.originalSelector}</code>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {element.healedAt ? (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            {t('settings.elements.healed', 'healed')}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right align-top space-x-1 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!isDirty || saveSelector.isPending}
                          onClick={() => saveSelector.mutate({ id: element.id, selector: draft })}
                          aria-label={t('settings.elements.saveSelector', 'Save selector')}
                        >
                          {saveSelector.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteElement.isPending}
                          onClick={() => deleteElement.mutate(element.id)}
                          aria-label={t('settings.elements.delete', 'Delete element')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ElementRepositoryCard;
