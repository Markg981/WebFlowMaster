import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { HUB_MODULE_IMPORT_MAX_MODULES } from '@shared/testcases-hub';
import { hubErrorMessage, type HubModuleCoverage } from '@/hooks/useTestCaseHub';
import { useImportHubModules, type HubJob } from '@/hooks/useHubWaves';

/**
 * Importing whole modules of the catalog: every case of the chosen modules that is not a test yet
 * becomes a manual test, each module into its suite (`QA hub · <module>`), with no cap on the
 * number of cases. The work is a background job; the dialog closes once it has started and the
 * catalog shows its progress.
 */

interface ProjectOption {
  id: number;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: HubModuleCoverage[];
  onStarted: (job: HubJob) => void;
}

const NONE = 'none';

/** How many cases of a module the import would take up with these options. */
export function pendingCases(
  row: HubModuleCoverage,
  includeDeprecated: boolean,
  updateChanged: boolean,
): number {
  const missing = includeDeprecated ? row.total - row.imported : row.active - row.importedActive;
  return Math.max(0, missing) + (updateChanged ? row.changed : 0);
}

const HubModuleImportDialog: React.FC<Props> = ({ open, onOpenChange, modules, onStarted }) => {
  const { t } = useTranslation();
  const importModules = useImportHubModules();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState(NONE);
  const [variant, setVariant] = useState<'standard' | 'reference'>('standard');
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [updateChanged, setUpdateChanged] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ['/api/projects'],
    queryFn: async () => (await apiRequest('GET', '/api/projects')).json(),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setFormError('');
      setSelected(new Set());
    }
  }, [open]);

  const pending = useMemo(
    () =>
      new Map(modules.map((m) => [m.module, pendingCases(m, includeDeprecated, updateChanged)])),
    [modules, includeDeprecated, updateChanged],
  );
  const selectable = modules.filter((m) => (pending.get(m.module) ?? 0) > 0);
  const chosen = Array.from(selected).filter((m) => (pending.get(m) ?? 0) > 0);
  const totalCases = chosen.reduce((sum, m) => sum + (pending.get(m) ?? 0), 0);
  const tooMany = chosen.length > HUB_MODULE_IMPORT_MAX_MODULES;
  const allChosen = selectable.length > 0 && selectable.every((m) => selected.has(m.module));

  const toggle = (module: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(module);
      else next.delete(module);
      return next;
    });

  const submit = () => {
    setFormError('');
    importModules.mutate(
      {
        modules: chosen,
        projectId: projectId === NONE ? null : Number(projectId),
        variant,
        includeDeprecated,
        updateChanged,
      },
      {
        onSuccess: (job) => {
          onStarted(job);
          onOpenChange(false);
        },
        onError: (error) => setFormError(hubErrorMessage(error, t)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="hub-module-import-dialog">
        <DialogHeader>
          <DialogTitle>{t('testCaseHub.modules.title', 'Import modules')}</DialogTitle>
          <DialogDescription>
            {t(
              'testCaseHub.modules.description',
              'Every case of the chosen modules that is not a test yet becomes a manual test, in the suite “QA hub · <module>”. Cases already imported are left as they are.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t('testCaseHub.modules.modules', 'Modules')}</Label>
              <Button
                variant="ghost"
                size="sm"
                disabled={selectable.length === 0}
                onClick={() =>
                  setSelected(allChosen ? new Set() : new Set(selectable.map((m) => m.module)))
                }
                data-testid="hub-module-import-all"
              >
                {allChosen
                  ? t('testCaseHub.modules.none', 'Select none')
                  : t('testCaseHub.modules.all', 'Select all')}
              </Button>
            </div>
            <div
              className="max-h-72 overflow-y-auto rounded-md border"
              data-testid="hub-module-import-list"
            >
              {modules.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {t(
                    'testCaseHub.modules.empty',
                    'The catalog has no modules yet. Refresh it first.',
                  )}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                    <tr>
                      <th className="w-8 p-2" />
                      <th className="p-2 text-left font-medium">
                        {t('testCaseHub.modules.module', 'Module')}
                      </th>
                      <th className="p-2 text-right font-medium">
                        {t('testCaseHub.modules.active', 'Active')}
                      </th>
                      <th className="p-2 text-right font-medium">
                        {t('testCaseHub.modules.inLibrary', 'In the library')}
                      </th>
                      <th className="p-2 text-right font-medium">
                        {t('testCaseHub.modules.toImport', 'To import')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((row) => {
                      const count = pending.get(row.module) ?? 0;
                      const id = `hubModule-${row.module}`;
                      return (
                        <tr
                          key={row.module}
                          className="border-t"
                          data-testid="hub-module-import-row"
                        >
                          <td className="p-2">
                            <Checkbox
                              id={id}
                              checked={selected.has(row.module) && count > 0}
                              disabled={count === 0}
                              onCheckedChange={(value) => toggle(row.module, value === true)}
                              aria-label={row.module}
                            />
                          </td>
                          <td className="p-2">
                            <label htmlFor={id}>{row.module}</label>
                          </td>
                          <td className="p-2 text-right tabular-nums">{row.active}</td>
                          <td className="p-2 text-right tabular-nums">{row.imported}</td>
                          <td className="p-2 text-right font-medium tabular-nums">{count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hubModuleDeprecated"
                checked={includeDeprecated}
                onCheckedChange={(value) => setIncludeDeprecated(value === true)}
              />
              <Label htmlFor="hubModuleDeprecated" className="font-normal">
                {t('testCaseHub.modules.includeDeprecated', 'Include deprecated cases')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="hubModuleChanged"
                checked={updateChanged}
                onCheckedChange={(value) => setUpdateChanged(value === true)}
              />
              <Label htmlFor="hubModuleChanged" className="font-normal">
                {t(
                  'testCaseHub.modules.updateChanged',
                  'Also update the tests whose case changed in the hub',
                )}
              </Label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hubModuleImportProject">
                {t('hubWaves.import.project', 'Project')}
              </Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="hubModuleImportProject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t('hubWaves.import.noProject', 'No project')}
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('hubWaves.import.variant', 'Steps of the new tests')}</Label>
              <RadioGroup
                value={variant}
                onValueChange={(value) => setVariant(value as 'standard' | 'reference')}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="standard" id="hubModuleVariantStandard" />
                  <Label htmlFor="hubModuleVariantStandard" className="font-normal">
                    {t('hubWaves.import.standard', 'The ordinary steps')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="reference" id="hubModuleVariantReference" />
                  <Label htmlFor="hubModuleVariantReference" className="font-normal">
                    {t('hubWaves.import.reference', 'The reference environment steps')}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {tooMany && (
            <p className="text-sm text-destructive">
              {t('testCaseHub.modules.tooMany', {
                defaultValue: 'Import at most {{max}} modules at a time.',
                max: HUB_MODULE_IMPORT_MAX_MODULES,
              })}
            </p>
          )}
          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={importModules.isPending || tooMany || chosen.length === 0}
            data-testid="hub-module-import-submit"
          >
            {importModules.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('testCaseHub.modules.submit', {
              defaultValue: 'Import {{count}} cases',
              count: totalCases,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HubModuleImportDialog;
