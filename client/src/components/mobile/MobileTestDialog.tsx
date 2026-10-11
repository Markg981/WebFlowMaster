import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ScanSearch, Trash2, Upload } from 'lucide-react';
import MobileInspectorDialog, { type InspectorRequest } from './MobileInspectorDialog';
import MobileStepsEditor from './MobileStepsEditor';
import type { MobileGroupDefinition } from '@shared/mobile-groups';
import { mobileTestSchema, mobileStepsProblems, type MobileDeviceTarget } from '@shared/mobile';
import { MOBILE_PLATFORM_LABELS, type MobilePlatform, type MobileStep } from '@shared/mobile';

/**
 * Writing a mobile app test: the app, the device, and the steps, each naming its element the way
 * the app's view tree does (shared/mobile.ts). A problem with a step is shown on the step, before
 * anything is saved.
 */

export interface MobileTestRow {
  id: number;
  name: string;
  platform: MobilePlatform;
  app: string;
  deviceName: string;
  osVersion: string | null;
  deviceMatrix?: MobileDeviceTarget[];
  /** The grid it runs on in a plan; null when it runs only from its own page. */
  gridId?: string | null;
  /** Its project; in a restricted one only the project's members see it. */
  projectId?: number | null;
  steps: MobileStep[];
}

interface ProjectOption {
  id: number;
  name: string;
  /** What the requester may do in it: a viewer on a restricted project cannot put a test there. */
  access?: 'viewer' | 'editor' | 'owner' | null;
}

export interface GridOption {
  id: string;
  name: string;
  provider: string;
}

interface Props {
  isOpen: boolean;
  test: MobileTestRow | null;
  grids: GridOption[];
  onClose: () => void;
  onSaved: () => void;
}

/** The select's value for "no grid": a plan's run then reports the test as unable to run. */
const NO_GRID = '__none__';
const NO_PROJECT = '__none__';

let counter = 0;
const newStep = (): MobileStep => ({
  id: `m${Date.now().toString(36)}${(counter++).toString(36)}`,
  action: 'tap',
  target: '',
  value: '',
});

export default function MobileTestDialog({ isOpen, test, grids, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<MobilePlatform>('android');
  const [appRef, setAppRef] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [osVersion, setOsVersion] = useState('');
  const [planGrid, setPlanGrid] = useState(NO_GRID);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [steps, setSteps] = useState<MobileStep[]>([]);
  const [groups, setGroups] = useState<MobileGroupDefinition[]>([]);
  const [deviceMatrix, setDeviceMatrix] = useState<MobileDeviceTarget[]>([]);
  const [uploadGrid, setUploadGrid] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<InspectorRequest | null>(null);
  // Apps are uploaded to the clouds; a local Appium reads them from its own machine.
  const uploadGrids = grids.filter((grid) => grid.provider !== 'local_appium');
  const fileInput = useRef<HTMLInputElement>(null);

  // The projects, for the one the test belongs to; none when they cannot be read.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/projects')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => !cancelled && setProjects(Array.isArray(rows) ? rows : []))
      .catch(() => !cancelled && setProjects([]));
    fetch('/api/mobile-step-groups')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        if (!cancelled) setGroups(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setName(test?.name ?? '');
    setPlatform(test?.platform ?? 'android');
    setAppRef(test?.app ?? '');
    setDeviceName(test?.deviceName ?? '');
    setOsVersion(test?.osVersion ?? '');
    setDeviceMatrix(test?.deviceMatrix ?? []);
    // A new test runs in plans on the first grid there is: the choice it would most likely make.
    setPlanGrid(test ? (test.gridId ?? NO_GRID) : (grids[0]?.id ?? NO_GRID));
    setProjectId(test?.projectId ?? null);
    setSteps(test?.steps.length ? test.steps : [newStep()]);
    setUploadGrid(uploadGrids[0]?.id ?? '');
    setError(null);
    // Not on uploadGrids: a refetch of the upload grids must not clear a form being filled in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, test, grids]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/browser-grids/${uploadGrid}/apps`, {
        method: 'POST',
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || t('mobileTests.uploadFailed', 'The app was not uploaded.'));
      setAppRef(body.app);
      if (/\.ipa$/i.test(file.name)) setPlatform('ios');
      else if (/\.(apk|aab)$/i.test(file.name)) setPlatform('android');
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // The inspector opens the app on the grid the test runs on in plans, else the one uploads go to.
  const inspectGrid = planGrid !== NO_GRID ? planGrid : uploadGrid;
  const canInspect = Boolean(inspectGrid && appRef.trim() && deviceName.trim());
  const inspect = () => {
    setError(null);
    setInspecting({
      gridId: inspectGrid,
      platform,
      app: appRef.trim(),
      deviceName: deviceName.trim(),
      osVersion: osVersion.trim() || null,
    });
  };
  /** A step from the inspector, at the end; it takes the place of the blank step a new test starts with. */
  const addFromInspector = (picked: Pick<MobileStep, 'action' | 'target' | 'value'>) =>
    setSteps((current) => {
      const kept = current.length === 1 && !current[0].target && !current[0].value ? [] : current;
      return [
        ...kept,
        {
          ...newStep(),
          action: picked.action,
          target: picked.target ?? '',
          value: picked.value ?? '',
        },
      ];
    });

  const save = async () => {
    if (mobileStepsProblems(steps, platform).length)
      return setError(t('mobileTests.fixSteps', 'Correct the steps marked in red first.'));
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        platform,
        app: appRef,
        deviceName,
        osVersion: osVersion.trim() || null,
        deviceMatrix,
        gridId: planGrid === NO_GRID ? null : planGrid,
        projectId,
        steps,
      };
      const validated = mobileTestSchema.safeParse(payload);
      if (!validated.success) throw new Error(validated.error.issues[0].message);
      const response = await fetch(test ? `/api/mobile-tests/${test.id}` : '/api/mobile-tests', {
        method: test ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated.data),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || t('mobileTests.saveFailed', 'The test was not saved.'));
      onSaved();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {test
              ? t('mobileTests.editTitle', 'Edit mobile test')
              : t('mobileTests.newTitle', 'New mobile test')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'mobileTests.dialogDescription',
              'An Android or iOS app on a real device of a BrowserStack or LambdaTest grid. Name elements by accessibility id (~login), resource id (id=…), text (text=Sign in) or XPath.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="mobileName">{t('mobileTests.name', 'Name')}</Label>
            <Input
              id="mobileName"
              className="mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="mobilePlatform">{t('mobileTests.platform', 'Platform')}</Label>
            <Select
              value={platform}
              onValueChange={(value) => setPlatform(value as MobilePlatform)}
            >
              <SelectTrigger
                id="mobilePlatform"
                className="mt-1"
                aria-label={t('mobileTests.platform', 'Platform')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['android', 'ios'] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {MOBILE_PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="mobileApp">{t('mobileTests.app', 'App')}</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              <Input
                id="mobileApp"
                className="flex-1 min-w-[240px] font-mono text-xs"
                value={appRef}
                onChange={(e) => setAppRef(e.target.value)}
                placeholder={t(
                  'mobileTests.appPlaceholder',
                  'bs://… / lt://… / a path on the agent’s machine',
                )}
              />
              {uploadGrids.length > 0 && (
                <>
                  <Select value={uploadGrid} onValueChange={setUploadGrid}>
                    <SelectTrigger
                      className="w-44"
                      aria-label={t('mobileTests.uploadTo', 'Upload to')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {uploadGrids.map((grid) => (
                        <SelectItem key={grid.id} value={grid.id}>
                          {grid.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".apk,.aab,.ipa"
                    className="hidden"
                    aria-label={t('mobileTests.appFile', 'App file')}
                    onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading || !uploadGrid}
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {t('mobileTests.upload', 'Upload .apk / .ipa')}
                  </Button>
                </>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="mobileDevice">{t('mobileTests.device', 'Device')}</Label>
            <Input
              id="mobileDevice"
              className="mt-1"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={platform === 'ios' ? 'iPhone 15' : 'Google Pixel 8'}
            />
          </div>
          <div>
            <Label htmlFor="mobileOs">{t('mobileTests.osVersion', 'OS version (optional)')}</Label>
            <Input
              id="mobileOs"
              className="mt-1"
              value={osVersion}
              onChange={(e) => setOsVersion(e.target.value)}
              placeholder={platform === 'ios' ? '17' : '14.0'}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="mobileProject">{t('mobileTests.project', 'Project')}</Label>
            <Select
              value={projectId == null ? NO_PROJECT : String(projectId)}
              onValueChange={(value) => setProjectId(value === NO_PROJECT ? null : Number(value))}
            >
              <SelectTrigger
                id="mobileProject"
                className="mt-1"
                aria-label={t('mobileTests.project', 'Project')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>
                  {t('mobileTests.noProject', 'No project')}
                </SelectItem>
                {projects.map((project) => (
                  <SelectItem
                    key={project.id}
                    value={String(project.id)}
                    disabled={project.access === 'viewer'}
                  >
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="mobilePlanGrid">
              {t('mobileTests.planGrid', 'Runs in test plans on')}
            </Label>
            <Select value={planGrid} onValueChange={setPlanGrid}>
              <SelectTrigger
                id="mobilePlanGrid"
                className="mt-1"
                aria-label={t('mobileTests.planGrid', 'Runs in test plans on')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GRID}>
                  {t('mobileTests.noPlanGrid', 'No grid: not runnable in plans')}
                </SelectItem>
                {grids.map((grid) => (
                  <SelectItem key={grid.id} value={grid.id}>
                    {grid.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'mobileTests.planGridHint',
                'A test plan runs this test on each configured device, independently of its web browsers.',
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('mobileTests.flow.matrix', 'Device/OS matrix')}</Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'mobileTests.flow.matrixHint',
              'An empty matrix uses the default device. Each row runs the same test separately on this platform.',
            )}
          </p>
          {deviceMatrix.map((target, index) => (
            <div className="flex gap-2" key={index}>
              <Input
                aria-label={t('mobileTests.flow.deviceOf', `Device ${index + 1}`, { number: index + 1 })}
                value={target.deviceName}
                onChange={(e) =>
                  setDeviceMatrix((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, deviceName: e.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                aria-label={t('mobileTests.flow.osOf', `OS version ${index + 1}`, { number: index + 1 })}
                value={target.osVersion ?? ''}
                onChange={(e) =>
                  setDeviceMatrix((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, osVersion: e.target.value } : row,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                aria-label={t('mobileTests.flow.removeDevice', `Remove device ${index + 1}`, {
                  number: index + 1,
                })}
                onClick={() => setDeviceMatrix((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={deviceMatrix.length >= 20}
            onClick={() =>
              setDeviceMatrix((rows) => [...rows, { deviceName: '', osVersion: null }])
            }
          >
            {t('mobileTests.flow.addDevice', 'Add device')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label>{t('mobileTests.steps', 'Steps')}</Label>
          <MobileStepsEditor
            steps={steps}
            platform={platform}
            groups={groups}
            allowGroups
            onChange={setSteps}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={inspect}
              disabled={!canInspect}
              title={
                canInspect
                  ? undefined
                  : t(
                      'mobileTests.inspectNeeds',
                      'The inspector needs a grid, the app and the device.',
                    )
              }
            >
              <ScanSearch className="mr-1 h-4 w-4" /> {t('mobileTests.inspect', 'Inspector')}
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('mobileTests.cancel', 'Cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('mobileTests.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
      <MobileInspectorDialog
        isOpen={inspecting !== null}
        request={inspecting}
        onClose={() => setInspecting(null)}
        onAddStep={addFromInspector}
      />
    </Dialog>
  );
}
