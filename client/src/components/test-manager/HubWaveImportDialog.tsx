import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
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
import { HUB_WAVE_IMPORT_MAX_WAVES } from '@shared/hub-waves';
import { hubErrorMessage } from '@/hooks/useTestCaseHub';
import { useImportHubWaves, type HubJob } from '@/hooks/useHubWaves';

/**
 * Importing waves: each becomes a WFM plan with one run holding the QA team's results, and the
 * cases it names that are not tests yet are imported from the catalog first. The work is a
 * background job; the dialog closes once it has started and the panel shows its progress.
 */

interface ProjectOption {
  id: number;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  waveIds: number[];
  onStarted: (job: HubJob) => void;
}

const NONE = 'none';

const HubWaveImportDialog: React.FC<Props> = ({ open, onOpenChange, waveIds, onStarted }) => {
  const { t } = useTranslation();
  const importWaves = useImportHubWaves();
  const [projectId, setProjectId] = useState(NONE);
  const [variant, setVariant] = useState<'standard' | 'reference'>('standard');
  const [formError, setFormError] = useState('');

  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ['/api/projects'],
    queryFn: async () => (await apiRequest('GET', '/api/projects')).json(),
    enabled: open,
  });

  useEffect(() => {
    if (open) setFormError('');
  }, [open]);

  const tooMany = waveIds.length > HUB_WAVE_IMPORT_MAX_WAVES;

  const submit = () => {
    setFormError('');
    importWaves.mutate(
      { waveIds, projectId: projectId === NONE ? null : Number(projectId), variant },
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
      <DialogContent data-testid="hub-wave-import-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('hubWaves.import.title', {
              defaultValue: 'Import {{count}} waves',
              count: waveIds.length,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'hubWaves.import.description',
              'Each wave becomes a test plan with one run holding the QA team’s results. Cases that are not tests yet are imported from the catalog first. Importing again updates the run and keeps the verdicts given in WebFlowMaster.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hubWaveImportProject">{t('hubWaves.import.project', 'Project')}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="hubWaveImportProject">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('hubWaves.import.noProject', 'No project')}</SelectItem>
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
                <RadioGroupItem value="standard" id="hubWaveVariantStandard" />
                <Label htmlFor="hubWaveVariantStandard" className="font-normal">
                  {t('hubWaves.import.standard', 'The ordinary steps')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="reference" id="hubWaveVariantReference" />
                <Label htmlFor="hubWaveVariantReference" className="font-normal">
                  {t('hubWaves.import.reference', 'The reference environment steps')}
                </Label>
              </div>
            </RadioGroup>
          </div>
          {tooMany && (
            <p className="text-sm text-destructive">
              {t('hubWaves.import.tooMany', {
                defaultValue: 'Import at most {{max}} waves at a time.',
                max: HUB_WAVE_IMPORT_MAX_WAVES,
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
            disabled={importWaves.isPending || tooMany || waveIds.length === 0}
            data-testid="hub-wave-import-submit"
          >
            {importWaves.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('hubWaves.import.submit', 'Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HubWaveImportDialog;
