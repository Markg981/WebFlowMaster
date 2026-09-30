import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Bug, CheckCircle2, Loader2, Pause, Play, RotateCcw, SkipForward, Square, StepForward, X, XCircle } from 'lucide-react';
import {
  DEBUG_ENDED,
  allowedCommands,
  type DebugCommand,
  type DebugState,
  type DebugStepPatch,
} from '@shared/debug-session';

/**
 * A debug session seen from the builder: what the run is doing, where it stopped and why, the
 * page at that moment, and the commands that fit — continue, step, pass over, correct and try
 * again, stop.
 *
 * The session runs where the browsers run; this reads its state every POLL_MS and sends it
 * commands (server/routes/debug-sessions.routes.ts).
 */

const POLL_MS = 700;

export interface DebugStartPayload {
  name: string;
  url: string;
  sequence: unknown[];
  elements: unknown[];
  preconditions?: unknown[];
  environmentId?: number;
  dataset?: Array<Record<string, string>>;
  breakpoints: string[];
  /** The dataset row to debug with, counted from 0. */
  datasetRow?: number;
}

async function asJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function useDebugSession() {
  const [state, setState] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idRef = useRef<string | null>(null);

  const start = useCallback(async (payload: DebugStartPayload) => {
    setError(null);
    setBusy(true);
    try {
      const body = await asJson(await fetch('/api/debug-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      idRef.current = body.id;
      setState(body.state);
    } catch (startError: any) {
      setError(startError?.message ?? String(startError));
    } finally {
      setBusy(false);
    }
  }, []);

  const send = useCallback(async (command: DebugCommand) => {
    if (!idRef.current) return;
    setError(null);
    setBusy(true);
    try {
      await asJson(await fetch(`/api/debug-sessions/${idRef.current}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      }));
    } catch (commandError: any) {
      setError(commandError?.message ?? String(commandError));
    } finally {
      setBusy(false);
    }
  }, []);

  const close = useCallback(() => {
    if (idRef.current && state && !DEBUG_ENDED.has(state.status)) void send({ type: 'stop' });
    idRef.current = null;
    setState(null);
    setError(null);
  }, [send, state]);

  const ended = state ? DEBUG_ENDED.has(state.status) : true;
  useEffect(() => {
    if (ended || !idRef.current) return;
    const id = idRef.current;
    const timer = setInterval(async () => {
      try {
        const next = await asJson(await fetch(`/api/debug-sessions/${id}`));
        if (idRef.current === id) setState(next);
      } catch (pollError: any) {
        if (idRef.current === id) setError(pollError?.message ?? String(pollError));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [ended, state?.id]);

  return { state, error, busy, start, send, close };
}

export default function DebugPanel({
  state,
  error,
  busy,
  onCommand,
  onClose,
  onCorrection,
  isOwnStep,
}: {
  state: DebugState;
  error: string | null;
  busy: boolean;
  onCommand: (command: DebugCommand) => void;
  onClose: () => void;
  /** A correction to one of the test's own steps, to be copied into the builder. */
  onCorrection: (stepId: string, patch: DebugStepPatch) => void;
  /** Whether a step id is one of the test's own, as the builder shows it. */
  isOwnStep: (stepId: string) => boolean;
}) {
  const { t } = useTranslation();
  const paused = state.paused;
  const [selector, setSelector] = useState('');
  const [value, setValue] = useState('');

  // A new stop: the fields start from the step as it is.
  useEffect(() => {
    setSelector(paused?.selector ?? '');
    setValue(paused?.value ?? '');
  }, [paused?.pc, paused?.reason, paused?.selector, paused?.value]);

  const allowed = allowedCommands(state);
  const can = (type: DebugCommand['type']) => allowed.includes(type) && !busy;

  const patch = (): DebugStepPatch | undefined => {
    if (!paused) return undefined;
    const next: DebugStepPatch = {};
    if (paused.selector !== null && selector.trim() && selector.trim() !== paused.selector) next.selector = selector.trim();
    if (value !== (paused.value ?? '')) next.value = value;
    return Object.keys(next).length > 0 ? next : undefined;
  };

  const go = (type: 'continue' | 'step' | 'retry') => {
    const correction = patch();
    if (correction && paused?.stepId && !paused.calledFrom && isOwnStep(paused.stepId)) onCorrection(paused.stepId, correction);
    onCommand({ type, patch: correction });
  };

  const reasonText = paused
    ? {
        breakpoint: t('debugger.reason.breakpoint', 'Stopped at the breakpoint before “{{name}}”.', { name: paused.name }),
        step: t('debugger.reason.step', 'Stopped before “{{name}}”.', { name: paused.name }),
        pause: t('debugger.reason.pause', 'Paused before “{{name}}”.', { name: paused.name }),
        failure: t('debugger.reason.failure', '“{{name}}” failed.', { name: paused.name }),
      }[paused.reason]
    : null;

  return (
    <Card className="fixed right-4 top-20 z-50 w-[420px] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto p-4 shadow-2xl space-y-3" role="region" aria-label={t('debugger.title', 'Debugger')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-primary" />
          <span className="font-semibold">{t('debugger.title', 'Debugger')}</span>
          <Badge variant={state.status === 'paused' ? 'default' : 'secondary'}>{t(`debugger.status.${state.status}`, state.status)}</Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('debugger.close', 'Close the debugger')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {(state.status === 'running' || state.status === 'starting') && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          {state.status === 'starting' ? t('debugger.starting', 'Opening the browser…') : t('debugger.running', 'Running…')}
        </p>
      )}

      {paused && (
        <div className="space-y-3">
          <p className={`text-sm font-medium ${paused.reason === 'failure' ? 'text-destructive' : ''}`}>{reasonText}</p>
          {paused.error && <p className="text-xs text-destructive whitespace-pre-line break-words" role="alert">{paused.error}</p>}
          {paused.screenshot && (
            <img src={paused.screenshot} alt={t('debugger.screenshot', 'The page now')} className="w-full rounded border" />
          )}
          {paused.url && <p className="text-[11px] text-muted-foreground break-all">{paused.url}</p>}

          <div className="space-y-2">
            {paused.selector !== null && (
              <div className="space-y-1">
                <Label htmlFor="debug-selector" className="text-xs">{t('debugger.selector', 'Selector')}</Label>
                <Input id="debug-selector" value={selector} onChange={(e) => setSelector(e.target.value)} className="h-8 text-xs font-mono" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="debug-value" className="text-xs">{t('debugger.value', 'Value')}</Label>
              <Input id="debug-value" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {paused.calledFrom
                ? t('debugger.correction.group', 'This step is inside a step group: a correction applies to this run only.')
                : t('debugger.correction.test', 'A correction is copied into the test; save it to keep it.')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {paused.reason === 'failure' ? (
              <Button size="sm" onClick={() => go('retry')} disabled={!can('retry')}>
                <RotateCcw className="mr-1 h-4 w-4" />
                {t('debugger.retry', 'Retry')}
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={() => go('continue')} disabled={!can('continue')}>
                  <Play className="mr-1 h-4 w-4" />
                  {t('debugger.continue', 'Continue')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => go('step')} disabled={!can('step')}>
                  <StepForward className="mr-1 h-4 w-4" />
                  {t('debugger.step', 'Step')}
                </Button>
              </>
            )}
            {paused.canSkip && (
              <Button size="sm" variant="outline" onClick={() => onCommand({ type: 'skip' })} disabled={!can('skip')}>
                <SkipForward className="mr-1 h-4 w-4" />
                {t('debugger.skip', 'Skip')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onCommand({ type: 'stop' })} disabled={!can('stop')}>
              <Square className="mr-1 h-4 w-4" />
              {t('debugger.stop', 'Stop')}
            </Button>
          </div>
        </div>
      )}

      {!paused && !DEBUG_ENDED.has(state.status) && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onCommand({ type: 'pause' })} disabled={!can('pause')}>
            <Pause className="mr-1 h-4 w-4" />
            {t('debugger.pause', 'Pause')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onCommand({ type: 'stop' })} disabled={!can('stop')}>
            <Square className="mr-1 h-4 w-4" />
            {t('debugger.stop', 'Stop')}
          </Button>
        </div>
      )}

      {state.outcome && (
        <p className={`flex items-center gap-2 text-sm font-medium ${state.outcome.success ? 'text-success' : 'text-destructive'}`} role="status">
          {state.outcome.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {state.status === 'stopped'
            ? t('debugger.outcome.stopped', 'Stopped.')
            : state.outcome.success
              ? t('debugger.outcome.passed', 'The test passed.')
              : t('debugger.outcome.failed', 'The test did not pass.')}
          {state.outcome.skipped > 0 && ` ${t('debugger.outcome.skipped', '{{count}} step(s) passed over.', { count: state.outcome.skipped })}`}
        </p>
      )}
      {state.outcome?.error && state.status !== 'stopped' && <p className="text-xs text-destructive break-words">{state.outcome.error}</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      {state.steps.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('debugger.steps', 'Steps run')}</h4>
          <ol className="space-y-1 text-xs">
            {state.steps.map((step, index) => (
              <li key={index} className="flex items-center gap-2">
                {step.status === 'passed' && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                {step.status === 'failed' && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                {step.status === 'skipped' && <SkipForward className="h-3 w-3 text-muted-foreground shrink-0" />}
                <span className="truncate" title={step.detail}>{step.name}</span>
                {step.corrected && <Badge variant="outline" className="text-[10px]">{t('debugger.corrected.badge', 'corrected')}</Badge>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.variables.length > 0 && (
        <details>
          <summary className="text-xs font-semibold uppercase text-muted-foreground cursor-pointer">{t('debugger.variables', 'Variables')}</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {state.variables.map((variable) => (
              <React.Fragment key={variable.name}>
                <dt className="font-mono">{variable.name}</dt>
                <dd className="break-all text-muted-foreground">{variable.value ?? t('debugger.fromEnvironment', '(from the environment, hidden)')}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      )}
    </Card>
  );
}
