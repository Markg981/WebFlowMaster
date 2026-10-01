import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowDown, ArrowUp, CheckSquare, Circle, Hand, KeyboardOff, Loader2, MousePointerClick, Plus, RefreshCw, Trash2, Type as TypeIcon } from 'lucide-react';
import { MOBILE_ACTIONS, type MobileActionId, type MobilePlatform, type MobileStep } from '@shared/mobile';
import { findNode, flatten, nodeAt, suggestLocators, type InspectorNode } from '@shared/mobile-inspector';
import { currentText, dragDirection, isSecretField, isTextField, recordTarget } from '@shared/mobile-recorder';

/**
 * The inspector: the app open on a real device of the grid, its screen and its view tree side by
 * side. Clicking the screen picks the element under the pointer and offers the locators a step can
 * name it with, unique ones first; "Add step" puts one into the test. The device can be driven
 * from here — tap, type, back, swipe — to reach the next screen.
 *
 * In Record mode every touch on the screen is done on the device and becomes a step: a tap names the
 * element under the finger with its sturdiest locator, a drag becomes a swipe, a tap on a text field
 * asks what to type, and the Check buttons turn the next click into an assertion. Steps wait in a
 * list to be corrected, reordered or removed, and go into the test together.
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

type StepFields = Pick<MobileStep, 'action' | 'target' | 'value'>;

/** A step recorded on the device, waiting in the list. */
interface Recorded {
  key: number;
  step: StepFields;
  /** Its locator only names a position: it breaks when the layout changes. */
  fragile?: boolean;
  /** Typed into a password field: better as a {{variable}} than written into the test. */
  secret?: boolean;
}

type Mode = 'select' | 'tap' | 'record';
type Check = 'assertVisible' | 'assertText';

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
  const [mode, setMode] = useState<Mode>('select');
  const tapMode = mode === 'tap';
  const recording = mode === 'record';
  const [check, setCheck] = useState<Check | null>(null);
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [typingInto, setTypingInto] = useState<{ locator: string; secret: boolean; fragile: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const nextKey = useRef(0);
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
    setRecorded([]);
    setTypingInto(null);
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
    if (recorded.length > 0 && !window.confirm(t('mobileInspector.discardRecorded', 'Close and lose the {{count}} recorded step(s) not added to the test?', { count: recorded.length }))) return;
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
    type: t('mobileTests.actions.type', 'Type'),
    assertText: t('mobileTests.actions.assertText', 'Assert text'),
    swipe: t('mobileTests.actions.swipe', 'Swipe'),
    back: t('mobileTests.actions.back', 'Back'),
    hideKeyboard: t('mobileTests.actions.hideKeyboard', 'Hide keyboard'),
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

  /** Does it on the device; in Record mode, a step that worked joins the list. True when it worked. */
  const act = async (body: unknown, asStep?: Omit<Recorded, 'key'>): Promise<boolean> => {
    if (!snapshot) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next: Snapshot = await call('POST', `/api/mobile-inspector/${snapshot.id}/actions`, body);
      setSnapshot(next);
      setSelectedId(null);
      if (next.error) {
        setError(next.error);
        return false;
      }
      if (recording && asStep) setRecorded((list) => [...list, { key: nextKey.current++, ...asStep }]);
      return true;
    } catch (actError) {
      setError((actError as Error).message);
      return false;
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
    if (!tree || !snapshot || recording) return;
    const point = pointOf(event);
    if (tapMode) return void act({ kind: 'tapAt', x: Math.round(point.x), y: Math.round(point.y) });
    setSelectedId(nodeAt(tree, point.x, point.y)?.id ?? null);
  };

  /** An assertion on a node, checked on the device before it is recorded. */
  const assertOn = (node: InspectorNode, kind: Check) => {
    if (!tree || !snapshot) return;
    const target = recordTarget(tree, node, snapshot.platform);
    if (!target) return;
    const value = kind === 'assertText' ? currentText(node, snapshot.platform) : undefined;
    if (kind === 'assertText' && !value) return void setNotice(t('mobileInspector.noText', 'This element shows no text to check.'));
    void act(step(kind, target.locator, value), { step: { action: kind, target: target.locator, ...(value !== undefined ? { value } : {}) }, fragile: target.fragile });
  };

  /** Record mode: a finger down and up on the picture is a tap, or a swipe when it moved. */
  const onRecordDown = (event: React.MouseEvent) => {
    if (recording && snapshot) dragFrom.current = pointOf(event);
  };
  const onRecordUp = async (event: React.MouseEvent) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!recording || !from || !tree || !snapshot || busy) return;
    const to = pointOf(event);
    const direction = dragDirection(from, to, snapshot.window);
    if (direction) {
      setTypingInto(null);
      return void act(step('swipe', undefined, direction), { step: { action: 'swipe', value: direction } });
    }
    const node = nodeAt(tree, to.x, to.y);
    if (check) {
      setCheck(null);
      if (node) assertOn(node, check);
      return;
    }
    const target = node ? recordTarget(tree, node, snapshot.platform) : null;
    if (!node || !target) {
      // Nothing there can be named: done on the device so the person can go on, but not recorded.
      await act({ kind: 'tapAt', x: Math.round(to.x), y: Math.round(to.y) });
      return void setNotice(t('mobileInspector.unnamed', 'Nothing there can be named, so the tap was done but not recorded.'));
    }
    const done = await act(step('tap', target.locator), { step: { action: 'tap', target: target.locator }, fragile: target.fragile });
    setTypingInto(done && isTextField(node) ? { locator: target.locator, secret: isSecretField(node), fragile: target.fragile } : null);
  };

  const typeRecorded = async () => {
    if (!typingInto) return;
    const { locator, secret, fragile } = typingInto;
    if (await act(step('type', locator, typed), { step: { action: 'type', target: locator, value: typed }, secret, fragile })) {
      setTyped('');
      setTypingInto(null);
    }
  };

  const updateRecorded = (key: number, change: Partial<StepFields>) =>
    setRecorded((list) => list.map((item) => (item.key === key ? { ...item, step: { ...item.step, ...change }, ...(change.target !== undefined ? { fragile: false } : {}) } : item)));
  const moveRecorded = (index: number, by: number) =>
    setRecorded((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  const addRecorded = () => {
    for (const item of recorded) onAddStep(item.step);
    setAdded((n) => n + recorded.length);
    setRecorded([]);
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
                {(['select', 'tap', 'record'] as const).map((id) => {
                  const Icon = id === 'select' ? MousePointerClick : id === 'tap' ? Hand : Circle;
                  const text = id === 'select' ? t('mobileInspector.select', 'Select') : id === 'tap' ? t('mobileInspector.tapMode', 'Tap on the device') : t('mobileInspector.recordMode', 'Record');
                  return (
                    <Button
                      key={id}
                      size="sm"
                      variant={mode === id ? (id === 'record' ? 'destructive' : 'default') : 'outline'}
                      onClick={() => {
                        setMode(id);
                        setCheck(null);
                        setTypingInto(null);
                      }}
                      aria-pressed={mode === id}
                    >
                      <Icon className={`mr-1 h-4 w-4 ${id === 'record' && recording ? 'fill-current' : ''}`} /> {text}
                    </Button>
                  );
                })}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('back'), { step: { action: 'back' } })} aria-label={t('mobileTests.actions.back', 'Back')}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('swipe', undefined, 'up'), { step: { action: 'swipe', value: 'up' } })} aria-label={t('mobileInspector.swipeUp', 'Swipe up')}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('swipe', undefined, 'down'), { step: { action: 'swipe', value: 'down' } })} aria-label={t('mobileInspector.swipeDown', 'Swipe down')}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(step('hideKeyboard'), { step: { action: 'hideKeyboard' } })} aria-label={t('mobileTests.actions.hideKeyboard', 'Hide keyboard')}>
                  <KeyboardOff className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={refresh} aria-label={t('mobileInspector.refresh', 'Read the screen again')}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              {recording && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{t('mobileInspector.recordHint', 'Tap or drag on the screen. Next click:')}</span>
                  {(['assertVisible', 'assertText'] as const).map((kind) => (
                    <Button key={kind} size="sm" variant={check === kind ? 'default' : 'outline'} className="h-7" onClick={() => setCheck(check === kind ? null : kind)} aria-pressed={check === kind}>
                      <CheckSquare className="mr-1 h-3.5 w-3.5" />
                      {kind === 'assertVisible' ? t('mobileInspector.checkVisible', 'Check it is visible') : t('mobileInspector.checkText', 'Check its text')}
                    </Button>
                  ))}
                </div>
              )}
              {snapshot.screenshot ? (
                <div className="relative inline-block max-w-full" onMouseLeave={() => setHoverId(null)}>
                  <img
                    ref={image}
                    src={`data:image/png;base64,${snapshot.screenshot}`}
                    alt={t('mobileInspector.screen', "The device's screen")}
                    className={`block max-h-[65vh] w-auto max-w-full select-none rounded border ${tapMode || recording ? 'cursor-pointer' : 'cursor-crosshair'} ${recording ? 'ring-2 ring-destructive/60' : ''}`}
                    draggable={false}
                    onClick={onPicture}
                    onMouseDown={onRecordDown}
                    onMouseUp={onRecordUp}
                    onMouseMove={(event) => tree && !tapMode && setHoverId(nodeAt(tree, pointOf(event).x, pointOf(event).y)?.id ?? null)}
                  />
                  {!tapMode && box(hovered, 'border border-sky-400/80 bg-sky-400/10', 'inspector-hover')}
                  {box(selected, 'border-2 border-primary bg-primary/10', 'inspector-selected')}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileInspector.noScreenshot', 'The grid sent no picture of the screen; pick elements from the list.')}</p>
              )}
              {notice && (
                <p className="text-xs text-muted-foreground" data-testid="inspector-notice">
                  {notice}
                </p>
              )}
              {typingInto && (
                <form
                  className="flex items-center gap-2"
                  data-testid="inspector-typing"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void typeRecorded();
                  }}
                >
                  <Input
                    autoFocus
                    className="h-8 flex-1"
                    type={typingInto.secret ? 'password' : 'text'}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    aria-label={t('mobileInspector.typeInto', 'Text to type into {{locator}}', { locator: typingInto.locator })}
                  />
                  <Button type="submit" size="sm" disabled={busy}>
                    <TypeIcon className="mr-1 h-4 w-4" /> {t('mobileInspector.typeIt', 'Type it')}
                  </Button>
                </form>
              )}
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
                      <Button size="sm" disabled={busy} onClick={() => act(step('tap', best), { step: { action: 'tap', target: best }, fragile: !suggestions[0].unique })}>
                        {t('mobileInspector.tapIt', 'Tap it on the device')}
                      </Button>
                      <Input className="h-8 w-40" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('mobileInspector.text', 'Text')} aria-label={t('mobileInspector.text', 'Text')} />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(step('type', best, typed), { step: { action: 'type', target: best, value: typed }, secret: isSecretField(selected), fragile: !suggestions[0].unique })}
                      >
                        {t('mobileInspector.typeIt', 'Type it')}
                      </Button>
                      {recording && (
                        <>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => assertOn(selected, 'assertVisible')}>
                            {t('mobileInspector.checkVisible', 'Check it is visible')}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => assertOn(selected, 'assertText')}>
                            {t('mobileInspector.checkText', 'Check its text')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileInspector.pick', 'Click an element on the screen, or in the list below.')}</p>
              )}

              {(recording || recorded.length > 0) && (
                <div className="rounded border p-3 space-y-2" data-testid="inspector-recorded">
                  <p className="text-sm font-medium">{t('mobileInspector.recorded', 'Recorded steps ({{count}})', { count: recorded.length })}</p>
                  {recorded.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('mobileInspector.recordedEmpty', 'What you do on the screen appears here. Nothing goes into the test until you add it.')}
                    </p>
                  ) : (
                    <ol className="space-y-1">
                      {recorded.map((item, index) => (
                        <li key={item.key} className="flex flex-wrap items-center gap-1 text-xs" data-testid="inspector-recorded-step">
                          <span className="w-5 text-right text-muted-foreground">{index + 1}.</span>
                          <span className="w-24 shrink-0 font-medium">{labels[item.step.action] ?? item.step.action}</span>
                          {MOBILE_ACTIONS[item.step.action].target && (
                            <Input
                              className="h-7 min-w-0 flex-1 font-mono text-xs"
                              value={item.step.target ?? ''}
                              onChange={(e) => updateRecorded(item.key, { target: e.target.value })}
                              aria-label={t('mobileInspector.recordedTarget', 'Element of recorded step {{n}}', { n: index + 1 })}
                            />
                          )}
                          {MOBILE_ACTIONS[item.step.action].value && (
                            <Input
                              className="h-7 w-32 text-xs"
                              type={item.secret && !item.step.value?.includes('{{') ? 'password' : 'text'}
                              value={item.step.value ?? ''}
                              onChange={(e) => updateRecorded(item.key, { value: e.target.value })}
                              aria-label={t('mobileInspector.recordedValue', 'Value of recorded step {{n}}', { n: index + 1 })}
                            />
                          )}
                          {item.fragile && (
                            <Badge variant="outline" className="border-amber-500 text-amber-700" title={t('mobileInspector.fragileHelp', 'Only its position names this element: give it an accessibility id in the app, or pick a sturdier locator.')}>
                              {t('mobileInspector.fragile', 'fragile')}
                            </Badge>
                          )}
                          {item.secret && !item.step.value?.includes('{{') && (
                            <Badge variant="outline" className="border-amber-500 text-amber-700" title={t('mobileInspector.secretHelp', 'A password written into the test is visible to everyone who can read it: write {{password}} and set it in the environment.')}>
                              {t('mobileInspector.secret', 'password')}
                            </Badge>
                          )}
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === 0} onClick={() => moveRecorded(index, -1)} aria-label={t('mobileInspector.moveUp', 'Move step {{n}} up', { n: index + 1 })}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === recorded.length - 1} onClick={() => moveRecorded(index, 1)} aria-label={t('mobileInspector.moveDown', 'Move step {{n}} down', { n: index + 1 })}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRecorded((list) => list.filter((other) => other.key !== item.key))} aria-label={t('mobileInspector.removeStep', 'Remove step {{n}}', { n: index + 1 })}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {recorded.length > 0 && (
                    <div className="flex gap-2 border-t pt-2">
                      <Button size="sm" onClick={addRecorded}>
                        {t('mobileInspector.addRecorded', 'Add {{count}} step(s) to the test', { count: recorded.length })}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRecorded([])}>
                        {t('mobileInspector.discard', 'Discard')}
                      </Button>
                    </div>
                  )}
                </div>
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
