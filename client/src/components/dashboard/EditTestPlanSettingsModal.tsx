import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, PlusCircle, XCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { TestPlan } from '@shared/schema';

/**
 * Changing what a plan does on its next run, after it has been created.
 *
 * The three settings that decide that — which browsers it covers, whether its steps are
 * compared against a visual baseline, and where its notifications go — could only ever be
 * set while creating the plan. There was no edit screen at all, so a plan made before any
 * of them worked could not be given them without a hand-written PUT.
 */

interface MachineRow {
  key: string;
  browserName: string;
  headless: boolean;
}

interface NotificationSettingsShape {
  passed: boolean;
  failed: boolean;
  notExecuted: boolean;
  stopped: boolean;
  webhookUrl?: string | null;
}

interface EditTestPlanSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: TestPlan | null;
  onSaved: () => void;
}

const BROWSER_OPTIONS = ['chromium', 'chrome', 'firefox', 'webkit', 'edge'];

/** The three answers to "keep a recording?", in the order they escalate. */
const EVIDENCE_MODES = [
  { value: 'never', label: 'Never' },
  { value: 'on_failure', label: 'When the test fails' },
  { value: 'always', label: 'Always' },
];

/** The Select cannot hold an empty value, and "none" is a real choice here. */
const NO_TRACKER = 'none';

interface TrackerOption {
  id: string;
  name: string;
  provider: string;
}

const NOTIFICATION_KEYS: Array<keyof Omit<NotificationSettingsShape, 'webhookUrl'>> = [
  'passed',
  'failed',
  'notExecuted',
  'stopped',
];

/** The machine rows a plan holds, tolerant of the column coming back as text. */
function machinesFromPlan(plan: TestPlan | null): MachineRow[] {
  const raw = plan?.testMachinesConfig;
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((machine: any) => ({
    key: uuidv4(),
    browserName: typeof machine?.browserName === 'string' ? machine.browserName : 'chromium',
    headless: machine?.headless !== false,
  }));
}

function notificationsFromPlan(plan: TestPlan | null): NotificationSettingsShape {
  const raw = plan?.notificationSettings;
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  const source = (parsed ?? {}) as Partial<NotificationSettingsShape>;
  return {
    passed: source.passed !== false,
    failed: source.failed !== false,
    notExecuted: source.notExecuted !== false,
    stopped: source.stopped !== false,
    webhookUrl: source.webhookUrl ?? '',
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The "run on" value for the runners, since a Select item cannot have an empty value. */
const ON_RUNNERS = '__runners__';

const EditTestPlanSettingsModal: React.FC<EditTestPlanSettingsModalProps> = ({ isOpen, onClose, plan, onSaved }) => {
  const { t } = useTranslation();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [visualTestingEnabled, setVisualTestingEnabled] = useState(false);
  /** Whether a video and a Playwright trace of each run survive it. */
  const [captureVideo, setCaptureVideo] = useState<string>('never');
  const [captureTrace, setCaptureTrace] = useState<string>('never');
  /** Whether each test's requests are recorded as a HAR, summarised in the report. */
  const [captureNetwork, setCaptureNetwork] = useState<string>('never');
  /** Where the browsers come from: this server's runners, or the local agents of a pool. */
  const [runOn, setRunOn] = useState<string>(ON_RUNNERS);
  const [agentPools, setAgentPools] = useState<string[]>([]);
  /** How many of this plan's runs may be in flight at once. 1 is what every plan did before. */
  const [maxParallelTests, setMaxParallelTests] = useState('1');
  const [maxParallelError, setMaxParallelError] = useState('');
  /** Which tracker this plan's failures go to, and whether they go at all. */
  const [issueTrackerId, setIssueTrackerId] = useState<string>(NO_TRACKER);
  const [createIssuesOnFailure, setCreateIssuesOnFailure] = useState(false);
  const [trackers, setTrackers] = useState<TrackerOption[]>([]);
  const [notifications, setNotifications] = useState<NotificationSettingsShape>(notificationsFromPlan(null));
  const [webhookError, setWebhookError] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reload from the plan every time the dialog opens, so it never shows the previous plan's
  // settings — or a stale copy of this one's after somebody else changed it.
  useEffect(() => {
    if (!isOpen) return;
    setMachines(machinesFromPlan(plan));
    setVisualTestingEnabled(plan?.visualTestingEnabled === true);
    setCaptureVideo((plan as { captureVideo?: string } | null)?.captureVideo ?? 'never');
    setCaptureTrace((plan as { captureTrace?: string } | null)?.captureTrace ?? 'never');
    setCaptureNetwork((plan as { captureNetwork?: string } | null)?.captureNetwork ?? 'never');
    setRunOn((plan as { agentPool?: string | null } | null)?.agentPool ?? ON_RUNNERS);
    setMaxParallelTests(String(plan?.maxParallelTests ?? 1));
    setIssueTrackerId((plan as { issueTrackerId?: string | null } | null)?.issueTrackerId ?? NO_TRACKER);
    setCreateIssuesOnFailure((plan as { createIssuesOnFailure?: boolean } | null)?.createIssuesOnFailure === true);
    setNotifications(notificationsFromPlan(plan));
    setWebhookError('');
    setMaxParallelError('');
    setSubmitError(null);

    // The trackers this organization has, so the plan names one rather than being typed one.
    // A failure to load them leaves the list empty, which reads as "none configured" — the
    // truthful fallback, since a plan cannot file into a tracker this screen cannot name.
    fetch('/api/issue-trackers')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => setTrackers(Array.isArray(rows) ? rows : []))
      .catch(() => setTrackers([]));

    // The pools this organization's agents belong to. Revoked agents lend nothing, so their pools
    // are not offered; the plan's own pool stays in the list even if it has no agents left.
    fetch('/api/agents')
      .then((response) => (response.ok ? response.json() : { agents: [] }))
      .then((body: { agents?: Array<{ pool: string; revokedAt: string | null }> }) =>
        setAgentPools([...new Set((body.agents ?? []).filter((agent) => !agent.revokedAt).map((agent) => agent.pool))].sort()),
      )
      .catch(() => setAgentPools([]));
  }, [isOpen, plan]);

  const addMachine = () => {
    setMachines((previous) => [...previous, { key: uuidv4(), browserName: 'chromium', headless: true }]);
  };

  const removeMachine = (key: string) => {
    setMachines((previous) => previous.filter((machine) => machine.key !== key));
  };

  const updateMachine = (key: string, patch: Partial<MachineRow>) => {
    setMachines((previous) => previous.map((machine) => (machine.key === key ? { ...machine, ...patch } : machine)));
  };

  const handleSave = async () => {
    const webhookUrl = (notifications.webhookUrl ?? '').trim();
    if (webhookUrl !== '' && !/^https?:\/\//i.test(webhookUrl)) {
      setWebhookError(
        t('editTestPlanSettings.validation.webhookUrlInvalid', 'The notification URL must start with http:// or https://.'),
      );
      return;
    }
    setWebhookError('');

    const parallel = Number(maxParallelTests);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
      setMaxParallelError(
        t('editTestPlanSettings.validation.parallelInvalid', 'Run at most must be a whole number between 1 and 16.'),
      );
      return;
    }
    setMaxParallelError('');
    if (!plan) return;

    setIsSaving(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/test-plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Only the run settings. Omitting selectedTests leaves the plan's tests as they are.
          testMachinesConfig: machines.map(({ browserName, headless }) => ({ browserName, headless })),
          visualTestingEnabled,
          captureVideo,
          captureTrace,
          captureNetwork,
          agentPool: runOn === ON_RUNNERS ? null : runOn,
          maxParallelTests: parallel,
          issueTrackerId: issueTrackerId === NO_TRACKER ? null : issueTrackerId,
          // Filing is off unless a tracker is named: a plan set to file into nothing would
          // report a failure to file on every failing run, which is noise about noise.
          createIssuesOnFailure: issueTrackerId !== NO_TRACKER && createIssuesOnFailure,
          notificationSettings: { ...notifications, webhookUrl: webhookUrl || null },
        }),
      });
      if (!response.ok) {
        let message = 'Failed to save the plan settings';
        try {
          const body = await response.json();
          message = body.error || body.message || message;
        } catch {
          /* response was not JSON */
        }
        throw new Error(message);
      }
      onSaved();
      onClose();
    } catch (error: any) {
      setSubmitError(error?.message ?? 'Failed to save the plan settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('editTestPlanSettings.title', 'Run settings')}</DialogTitle>
          <DialogDescription>
            {plan?.name
              ? t('editTestPlanSettings.description', 'What "{{name}}" does on its next run.', { name: plan.name })
              : ''}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-6">
            <section>
              <Label>{t('editTestPlanSettings.browsers.label', 'Browsers')}</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  'editTestPlanSettings.browsers.help',
                  'Every test in this plan runs once per browser listed here. With none listed, a run uses the browser from your own settings.',
                )}
              </p>
              <div className="mt-2 space-y-2">
                {machines.map((machine) => (
                  <div key={machine.key} className="flex items-center gap-2">
                    <Select value={machine.browserName} onValueChange={(value) => updateMachine(machine.key, { browserName: value })}>
                      <SelectTrigger className="w-[180px]" aria-label={t('editTestPlanSettings.browsers.selectLabel', 'Browser')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BROWSER_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`headless-${machine.key}`}
                        checked={machine.headless}
                        onCheckedChange={(checked) => updateMachine(machine.key, { headless: !!checked })}
                      />
                      <Label htmlFor={`headless-${machine.key}`} className="font-normal">
                        {t('editTestPlanSettings.browsers.headless', 'Headless')}
                      </Label>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMachine(machine.key)}
                      aria-label={t('editTestPlanSettings.browsers.remove', 'Remove browser')}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addMachine}>
                  <PlusCircle className="h-4 w-4 mr-1" /> {t('editTestPlanSettings.browsers.add', 'Add browser')}
                </Button>
              </div>
            </section>

            <section>
              <Label>{t('editTestPlanSettings.runOn.label', 'Run on')}</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  'editTestPlanSettings.runOn.help',
                  'Where the browsers come from. A pool of local agents opens pages from inside its own network; API tests still go out from the server.',
                )}
              </p>
              <Select value={runOn} onValueChange={setRunOn}>
                <SelectTrigger className="mt-2 w-[260px]" aria-label={t('editTestPlanSettings.runOn.label', 'Run on')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ON_RUNNERS}>{t('editTestPlanSettings.runOn.runners', "This server's runners")}</SelectItem>
                  {[...new Set([...agentPools, ...(runOn === ON_RUNNERS ? [] : [runOn])])].map((pool) => (
                    <SelectItem key={pool} value={pool}>
                      {t('editTestPlanSettings.runOn.pool', 'Local agents: {{pool}}', { pool })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section>
              <Label htmlFor="editMaxParallelTests">
                {t('editTestPlanSettings.parallel.label', 'Run at most (tests at once)')}
              </Label>
              <Input
                id="editMaxParallelTests"
                value={maxParallelTests}
                onChange={(e) => setMaxParallelTests(e.target.value)}
                className="mt-1 w-32"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  'editTestPlanSettings.parallel.help',
                  'Each one is a real browser session, so this is a statement about the runner. 1 runs the plan one test at a time, browser by browser. A plan whose API tests capture values for later requests keeps those in order within each browser.',
                )}
              </p>
              {maxParallelError && <p className="text-sm text-destructive mt-1">{maxParallelError}</p>}
            </section>

            <section>
              <Label>{t('editTestPlanSettings.evidence.label', 'Keep a recording of the run')}</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  'editTestPlanSettings.evidence.help',
                  'A report holds a picture per step and the message it died with. A video and a Playwright trace answer what that cannot — a slow request, a dialog that came and went, a page that moved under the click. Both cost disk on every run.',
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <Label htmlFor="editCaptureVideo" className="text-xs text-muted-foreground">
                    {t('editTestPlanSettings.evidence.video', 'Video')}
                  </Label>
                  <Select value={captureVideo} onValueChange={setCaptureVideo}>
                    <SelectTrigger id="editCaptureVideo" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {t(`editTestPlanSettings.evidence.modes.${mode.value}`, mode.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="editCaptureTrace" className="text-xs text-muted-foreground">
                    {t('editTestPlanSettings.evidence.trace', 'Trace')}
                  </Label>
                  <Select value={captureTrace} onValueChange={setCaptureTrace}>
                    <SelectTrigger id="editCaptureTrace" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {t(`editTestPlanSettings.evidence.modes.${mode.value}`, mode.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="editCaptureNetwork" className="text-xs text-muted-foreground">
                    {t('editTestPlanSettings.evidence.network', 'Network (HAR)')}
                  </Label>
                  <Select value={captureNetwork} onValueChange={setCaptureNetwork}>
                    <SelectTrigger id="editCaptureNetwork" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {t(`editTestPlanSettings.evidence.modes.${mode.value}`, mode.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t(
                  'editTestPlanSettings.evidence.networkHelp',
                  'The report lists the failed and slowest requests of every recorded test, kept file or not. The HAR opens in any browser’s DevTools; it never holds bodies, cookies, tokens or passwords.',
                )}
              </p>
            </section>

            <section className="flex items-center space-x-2">
              <Switch id="editVisualTesting" checked={visualTestingEnabled} onCheckedChange={setVisualTestingEnabled} />
              <div>
                <Label htmlFor="editVisualTesting">{t('editTestPlanSettings.visualTesting.label', 'Visual testing')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'editTestPlanSettings.visualTesting.help',
                    'Compare each step against its stored baseline. The first run after turning this on records the baselines.',
                  )}
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <Label htmlFor="editIssueTracker">
                  {t('editTestPlanSettings.issues.trackerLabel', 'File failures in')}
                </Label>
                <Select value={issueTrackerId} onValueChange={setIssueTrackerId}>
                  <SelectTrigger id="editIssueTracker" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TRACKER}>
                      {t('editTestPlanSettings.issues.noTracker', 'Nowhere — failures stay in the report')}
                    </SelectItem>
                    {trackers.map((tracker) => (
                      <SelectItem key={tracker.id} value={tracker.id}>
                        {tracker.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="editCreateIssues"
                  checked={createIssuesOnFailure}
                  onCheckedChange={setCreateIssuesOnFailure}
                  disabled={issueTrackerId === NO_TRACKER}
                />
                <div>
                  <Label htmlFor="editCreateIssues">
                    {t('editTestPlanSettings.issues.autoLabel', 'Open an issue when a test fails')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'editTestPlanSettings.issues.autoHelp',
                      'One issue per failing test and browser. The same failure tomorrow night is added to it as a comment, not opened again.',
                    )}
                  </p>
                </div>
              </div>
            </section>

            <section>
              <Label>{t('editTestPlanSettings.notifications.label', 'Send notification when')}</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-1 p-3 border rounded-md">
                {NOTIFICATION_KEYS.map((key) => (
                  <div key={key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-notify-${key}`}
                      checked={notifications[key]}
                      onCheckedChange={(checked) => setNotifications((previous) => ({ ...previous, [key]: !!checked }))}
                    />
                    <Label htmlFor={`edit-notify-${key}`} className="font-normal capitalize">
                      {t(`createTestPlanWizard.step3.sendNotificationWhen.options.${key}`, key)}
                    </Label>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <Label htmlFor="editNotificationWebhookUrl">
                {t('editTestPlanSettings.webhook.label', 'Send notifications to (webhook URL)')}
              </Label>
              <Input
                id="editNotificationWebhookUrl"
                value={notifications.webhookUrl ?? ''}
                onChange={(e) => setNotifications((previous) => ({ ...previous, webhookUrl: e.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  'editTestPlanSettings.webhook.help',
                  'A Slack or Microsoft Teams incoming webhook, or any URL that accepts a POST. Without one, nothing is sent.',
                )}
              </p>
              {webhookError && <p className="text-sm text-destructive mt-1">{webhookError}</p>}
            </section>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !plan}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditTestPlanSettingsModal;
