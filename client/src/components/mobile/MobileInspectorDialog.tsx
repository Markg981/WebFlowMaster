import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowDown, ArrowUp, Hand, Loader2, MousePointerClick, Plus, RefreshCw } from 'lucide-react';
import type { MobileActionId, MobilePlatform, MobileStep } from '@shared/mobile';
import { findNode, flatten, nodeAt, suggestLocators, type InspectorNode } from '@shared/mobile-inspector';

/**
 * The inspector: the app open on a real device of the grid, its screen and its view tree side by
 * side. Clicking the screen picks the element under the pointer and offers the locators a step can
 * name it with, unique ones first; "Add step" puts one into the test. The device can be driven
 * from here — tap, type, back, swipe — to reach the next screen, and what is done can be recorded
 * as steps.
 */

export interface InspectorRequest {
  gridId: string;
  platform: MobilePlatform;
  app: string;
  deviceName: string;
  osVersion: string | null;
}

interface Snapshot {
  id: string;
  platform: MobilePlatform;
  screenshot: string | null;
  window: { width: number; height: number };
  tree: InspectorNode | null;
  device: string;
  error?: string | null;
}

interface Props {
  isOpen: boolean;
  request: InspectorRequest | null;
  onClose: () => void;
  /** A step for the test: added at the end of its steps. */
  onAddStep: (step: Pick<MobileStep, 'action' | 'target' | 'value'>) => void;
}

/** The actions an "Add step" can make of a locator: the ones that take an element and no value. */
const PICKABLE: MobileActionId[] = ['tap', 'assertVisible', 'waitFor', 'assertNotVisible', 'clear'];

async function call(method: string, url: string, body?: unknown): Promise<any> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const answer = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer?.error || `Request failed (${response.status})`);
  return answer;
}

const depthOf = (id: string) => id.split('.').length - 1;
const labelOf = (node: InspectorNode) =>
  node.attributes['content-desc'] || node.attributes.name || node.attributes.text || node.attributes.label || node.attributes['resource-id'] || '';
const shortType = (type: string) => type.replace(/^android\.(widget|view)\./, '').replace(/^XCUIElementType/, '');

export default function MobileInspectorDialog({ isOpen, request, onClose, onAddStep }: Props) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tapMode, setTapMode] = useState(false);
  const [record, setRecord] = useState(false);
  const [pickAction, setPickAction] = useState<MobileActionId>('tap');
  const [typed, setTyped] = useState('');
  const [added, setAdded] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !request) return;
    let cancelled = false;
    setSnapshot(null);
    setSelectedId(null);
    setError(null);
    setAdded(0);
    setOpening(true);
    call('POST', '/api/mobile-inspector', request)
      .then((opened: Snapshot) => {
        sessionId.current = opened.id;
        if (cancelled) return void call('DELETE', `/api/mobile-inspector/${opened.id}`).catch(() => undefined);
        setSnapshot(opened);
      })
      .catch((openError) => !cancelled && setError((openError as Error).message))
      .finally(() => !cancelled && setOpening(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, request]);

  // Closing the dialog ends the session on the grid: its minutes are paid for.
  const close = () => {
    if (sessionId.current) void call('DELETE', `/api/mobile-inspector/${sessionId.current}`).catch(() => undefined);
    sessionId.current = null;
    onClose();
  };

  const labels: Record<string, string> = {
    tap: t('mobileTests.actions.tap', 'Tap'),
    assertVisible: t('mobileTests.actions.assertVisible', 'Assert visible'),
    waitFor: t('mobileTests.actions.waitFor', 'Wait for element'),
    assertNotVisible: t('mobileTests.actions.assertNotVisible', 'Assert not visible'),
    clear: t('mobileTests.actions.clear', 'Clear'),
  };

  const tree = snapshot?.tree ?? null;
  const nodes = useMemo(() => (tree ? flatten(tree).filter((node) => node.bounds && node.bounds.width > 0 && node.bounds.height > 0) : []), [tree]);
  const selected = tree && selectedId ? findNode(tree, selectedId) : null;
  const hovered = tree && hoverId ? findNode(tree, hoverId) : null;
  const suggestions = useMemo(() => (tree && selected && snapshot ? suggestLocators(tree, selected, snapshot.platform) : []), [tree, selected, snapshot]);

  /** A pointer on the picture, in the tree's coordinates. */
  const pointOf = (event: React.MouseEvent) => {
    const rect = image.current!.getBoundingClientRect();
    const scale = snapshot!.window.width / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const act = async (body: unknown, asStep?: Pick<MobileStep, 'action' | 'target' | 'value'>) => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const next: Snapshot = await call('POST', `/api/mobile-inspector/${snapshot.id}/actions`, body);
      setSnapshot(next);
      setSelectedId(null);
      if (next.error) setError(next.error);
      else if (record && asStep) {
        onAddStep(asStep);
        setAdded((n) => n + 1);
      }
    } catch (actError) {
      setError((actError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await call('GET', `/api/mobile-inspector/${snapshot.id}`));
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const step = (action: MobileActionId, target?: string, value?: string) => ({
    kind: 'step',
    step: { id: `i${Date.now().toString(36)}`, action, ...(target !== undefined ? { target } : {}), ...(value !== undefined ? { value } : {}) },
  });
  const best = suggestions[0]?.locator;

  const onPicture = (event: React.MouseEvent) => {
    if (!tree || !snapshot) return;
    const point = pointOf(event);
    if (tapMode) return void act({ kind: 'tapAt', x: Math.round(point.x), y: Math.round(point.y) });
    setSelectedId(nodeAt(tree, point.x, point.y)?.id ?? null);
  };

  const box = (node: InspectorNode | null, className: string, testId: string) => {
    if (!node?.bounds || !snapshot) return null;
    const { x, y, width, height } = node.bounds;
    const w = snapshot.window.width || 1;
    const h = snapshot.window.height || 1;
    return (
      <div
        data-testid={testId}
        className={`pointer-events-none absolute ${className}`}
        style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: `${(width / w) * 100}%`, height: `${(height / h) * 100}%` }}
      />
    );
  };

  const addStep = (locator: string) => {
    onAddStep({ action: pickAction, target: locator });
    setAdded((n) => n + 1);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('mobileInspector.title', 'Inspector')}</DialogTitle>
          <DialogDescription>
            {snapshot?.device ||
              t('mobileInspector.description', 'Pick elements on a real device: click the screen, then add a step with the locator you want.')}
          </DialogDescription>
        </DialogHeader>

        {opening && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="inspector-opening">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('mobileInspector.opening', 'The grid is finding a {{device}} and installing the app — a minute or two.', { device: request?.deviceName ?? '' })}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {snapshot && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={tapMode ? 'outline' : 'default'} onClick={() => setTapMode(false)} aria-pressed={!tapMode}>
                  <MousePointerClick className="mr-1 h-4 w-4" /> {t('mobileInspector.select', 'Select')}
                </Button>
                <Button size="sm" variant={tapMode ? 'default' : 'outline'} onClick={() => setTapMode(true)} aria-pressed={tapMode}>
                  <Hand className="mr-1 h-4 w-4" /> {t('mobileInspector.tapMode', 'Tap on the device')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('back'), { action: 'back' })} aria-label={t('mobileTests.actions.back', 'Back')}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('swipe', undefined, 'up'), { action: 'swipe', value: 'up' })} aria-label={t('mobileInspector.swipeUp', 'Swipe up')}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('swipe', undefined, 'down'), { action: 'swipe', value: 'down' })} aria-label={t('mobileInspector.swipeDown', 'Swipe down')}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={refresh} aria-label={t('mobileInspector.refresh', 'Read the screen again')}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              {snapshot.screenshot ? (
                <div className="relative inline-block max-w-full" onMouseLeave={() => setHoverId(null)}>
                  <img
                    ref={image}
                    src={`data:image/png;base64,${snapshot.screenshot}`}
                    alt={t('mobileInspector.screen', "The device's screen")}
                    className={`block max-h-[65vh] w-auto max-w-full rounded border ${tapMode ? 'cursor-pointer' : 'cursor-crosshair'}`}
                    onClick={onPicture}
                    onMouseMove={(event) => tree && !tapMode && setHoverId(nodeAt(tree, pointOf(event).x, pointOf(event).y)?.id ?? null)}
                  />
                  {!tapMode && box(hovered, 'border border-sky-400/80 bg-sky-400/10', 'inspector-hover')}
                  {box(selected, 'border-2 border-primary bg-primary/10', 'inspector-selected')}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileInspector.noScreenshot', 'The grid sent no picture of the screen; pick elements from the list.')}</p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={record} onCheckedChange={(value) => setRecord(value === true)} />
                {t('mobileInspector.record', 'Record what I do here as steps')}
              </label>
              {added > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="inspector-added">
                  {t('mobileInspector.added', '{{count}} step(s) added to the test.', { count: added })}
                </p>
              )}
            </div>

            <div className="space-y-3 min-w-0">
              {selected ? (
                <div className="rounded border p-3 space-y-2" data-testid="inspector-element">
                  <p className="text-sm font-medium">
                    {shortType(selected.type)} <span className="font-normal text-muted-foreground">{labelOf(selected)}</span>
                  </p>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs">
                    {Object.entries(selected.attributes)
                      .filter(([name, value]) => value !== '' && ['text', 'content-desc', 'resource-id', 'name', 'label', 'value', 'enabled', 'checked'].includes(name))
                      .map(([name, value]) => (
                        <React.Fragment key={name}>
                          <dt className="text-muted-foreground">{name}</dt>
                          <dd className="font-mono break-all">{value}</dd>
                        </React.Fragment>
                      ))}
                  </dl>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="inspectorAction" className="text-xs">
                      {t('mobileInspector.addAs', 'Add as')}
                    </Label>
                    <Select value={pickAction} onValueChange={(value) => setPickAction(value as MobileActionId)}>
                      <SelectTrigger id="inspectorAction" className="h-8 w-48" aria-label={t('mobileInspector.addAs', 'Add as')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PICKABLE.map((id) => (
                          <SelectItem key={id} value={id}>
                            {labels[id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ul className="space-y-1">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.locator} className="flex items-center gap-2" data-testid="inspector-locator">
                        <code className="flex-1 min-w-0 truncate rounded bg-muted px-1 py-0.5 text-xs" title={suggestion.locator}>
                          {suggestion.locator}
                        </code>
                        <Badge variant={suggestion.unique ? 'secondary' : 'outline'} className="shrink-0">
                          {suggestion.unique ? t('mobileInspector.unique', 'unique') : t('mobileInspector.notUnique', 'not unique')}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => addStep(suggestion.locator)} aria-label={t('mobileInspector.addStepWith', 'Add step with {{locator}}', { locator: suggestion.locator })}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {best && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                      <Button size="sm" disabled={busy} onClick={() => act(step('tap', best), { action: 'tap', target: best })}>
                        {t('mobileInspector.tapIt', 'Tap it on the device')}
                      </Button>
                      <Input className="h-8 w-40" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('mobileInspector.text', 'Text')} aria-label={t('mobileInspector.text', 'Text')} />
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => act(step('type', best, typed), { action: 'type', target: best, value: typed })}>
                        {t('mobileInspector.typeIt', 'Type it')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileInspector.pick', 'Click an element on the screen, or in the list below.')}</p>
              )}

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t('mobileInspector.elements', 'Elements on this screen')}</p>
                <ul className="max-h-72 overflow-y-auto rounded border text-xs" data-testid="inspector-tree">
                  {nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        className={`w-full truncate px-2 py-0.5 text-left hover:bg-muted ${node.id === selectedId ? 'bg-primary/10 font-medium' : ''}`}
                        style={{ paddingLeft: `${0.5 + depthOf(node.id) * 0.75}rem` }}
                        onClick={() => setSelectedId(node.id)}
                        onMouseEnter={() => setHoverId(node.id)}
                      >
                        {shortType(node.type)} {labelOf(node) && <span className="text-muted-foreground">“{labelOf(node)}”</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t('mobileInspector.cost', 'The device stays yours while this is open and is released when you close it, or after five minutes without use.')}
        </p>
      </DialogContent>
    </Dialog>
  );
}
