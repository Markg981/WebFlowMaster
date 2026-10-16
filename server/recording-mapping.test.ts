import { describe, it, expect } from 'vitest';
import {
  ACTION_I18N,
  ADHOC_ACTION_IDS,
  RECORDED_TYPE_TO_ACTION_ID,
  RECORDED_ACTION_TYPES,
  RecordedActionSchema,
  mapRecordedActionToStep,
  mapRecordedSequence,
  unsupportedActions,
  type RecordedAction,
} from '../shared/recording';
import { AdhocTestStepSchema } from '../shared/schema';

const at = (overrides: Partial<RecordedAction>): RecordedAction => ({
  type: 'click',
  timestamp: 1_700_000_000_000,
  ...overrides,
});

describe('shared recording action table', () => {
  it('maps every recorded type to a known replay action (or explicitly to null)', () => {
    for (const type of RECORDED_ACTION_TYPES) {
      const actionId = RECORDED_TYPE_TO_ACTION_ID[type];
      expect(actionId === null || ADHOC_ACTION_IDS.includes(actionId)).toBe(true);
    }
  });

  it('has i18n metadata for every replay action', () => {
    for (const id of ADHOC_ACTION_IDS) {
      expect(ACTION_I18N[id]?.name).toBeTruthy();
      expect(ACTION_I18N[id]?.description).toBeTruthy();
    }
  });
});

describe('mapRecordedActionToStep', () => {
  it('maps a click into a step carrying the recorded selector', () => {
    const step = mapRecordedActionToStep(
      at({ type: 'click', selector: '#login', targetTag: 'button', targetText: 'Log in' }),
      0,
    );

    expect(step?.action.id).toBe('click');
    expect(step?.targetElement?.selector).toBe('#login');
    expect(step?.targetElement?.text).toBe('Log in');
  });

  it('maps the assert types the in-page recorder emits', () => {
    const contains = mapRecordedActionToStep(
      at({ type: 'assertTextContains', selector: '.total', value: '42 €' }),
      0,
    );
    expect(contains?.action.id).toBe('assertTextContains');
    expect(contains?.value).toBe('42 €');

    const count = mapRecordedActionToStep(
      at({ type: 'assertElementCount', selector: 'tr.row', value: '==3' }),
      1,
    );
    expect(count?.action.id).toBe('assertElementCount');
    expect(count?.value).toBe('==3');

    const visible = mapRecordedActionToStep(at({ type: 'assert', selector: '#banner' }), 2);
    expect(visible?.action.id).toBe('assert');
    expect(visible?.targetElement?.selector).toBe('#banner');
  });

  it('puts the URL in value for navigate steps, because replay does page.goto(value)', () => {
    const step = mapRecordedActionToStep(
      at({ type: 'navigate', url: 'https://app.test/orders' }),
      0,
    );

    expect(step?.action.id).toBe('navigate');
    expect(step?.value).toBe('https://app.test/orders');
  });

  it('drops the synthetic session bookkeeping entries', () => {
    expect(
      mapRecordedActionToStep(
        at({ type: 'navigate', url: 'https://app.test', meta: 'session-started' }),
        0,
      ),
    ).toBeNull();
    expect(
      mapRecordedActionToStep(
        at({ type: 'navigate', url: 'https://app.test', meta: 'session-stopped' }),
        1,
      ),
    ).toBeNull();
  });

  it('replays a recorded Enter as a key press in the field it was pressed in', () => {
    const step = mapRecordedActionToStep(at({ type: 'keypress', key: 'Enter', selector: '#q' }), 0);

    expect(step?.action.id).toBe('pressKey');
    expect(step?.value).toBe('Enter');
    expect(step?.targetElement?.selector).toBe('#q');
    expect(AdhocTestStepSchema.safeParse(step).success).toBe(true);
  });

  it('puts the value of a field before the Enter that submitted it', () => {
    // keydown fires before change, so the recorder hears the two the wrong way round.
    const steps = mapRecordedSequence([
      at({ type: 'keypress', key: 'Enter', selector: '#q', timestamp: 1 }),
      at({ type: 'input', selector: '#q', value: 'invoices', timestamp: 2 }),
    ]);

    expect(steps.map((s) => s.action.id)).toEqual(['input', 'pressKey']);
    expect(steps[0].value).toBe('invoices');
  });

  it('leaves an Enter alone when the next value belongs to another field', () => {
    const steps = mapRecordedSequence([
      at({ type: 'keypress', key: 'Enter', selector: '#q' }),
      at({ type: 'input', selector: '#other', value: 'x' }),
    ]);

    expect(steps.map((s) => s.action.id)).toEqual(['pressKey', 'input']);
  });

  it('turns a redacted field into a named variable placeholder, not an empty value', () => {
    const step = mapRecordedActionToStep(
      at({ type: 'input', selector: '#pwd', value: '', masked: true, targetId: 'loginPassword' }),
      0,
    );

    expect(step?.value).toBe('{{secret_loginPassword}}');
    // An empty value would be rejected by the replay schema with a misleading message.
    expect(AdhocTestStepSchema.safeParse(step).success).toBe(true);
  });

  it('falls back to the position when a redacted field has no id', () => {
    const step = mapRecordedActionToStep(
      at({ type: 'input', selector: '#pwd', value: '', masked: true }),
      3,
    );
    expect(step?.value).toBe('{{secret_3}}');
  });

  it('produces ids that depend only on position, so polling can diff by value', () => {
    const sequence = [at({ type: 'click', selector: '#a' })];
    expect(JSON.stringify(mapRecordedSequence(sequence))).toBe(
      JSON.stringify(mapRecordedSequence(sequence)),
    );
  });
});

describe('mapRecordedSequence → replay payload', () => {
  it('produces steps the execution endpoint accepts', () => {
    const steps = mapRecordedSequence([
      at({ type: 'navigate', url: 'https://app.test', meta: 'session-started' }),
      at({ type: 'click', selector: '#login', targetTag: 'button', targetText: 'Log in' }),
      at({ type: 'input', selector: '#user', value: 'marco', targetTag: 'input' }),
      at({ type: 'navigate', url: 'https://app.test/dashboard' }),
      at({ type: 'assertTextContains', selector: 'h1', value: 'Dashboard' }),
      at({ type: 'navigate', url: 'https://app.test/dashboard', meta: 'session-stopped' }),
    ]);

    expect(steps.map((s) => s.action.id)).toEqual([
      'click',
      'input',
      'navigate',
      'assertTextContains',
    ]);

    for (const step of steps) {
      const parsed = AdhocTestStepSchema.safeParse(step);
      expect(parsed.success, `step ${step.action.id}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });

  it('rejects a navigate step whose value is not an absolute URL', () => {
    const bad = {
      id: 'recorded-step-0',
      action: {
        id: 'navigate',
        type: 'navigate',
        name: ACTION_I18N.navigate.name,
        icon: ACTION_I18N.navigate.icon,
        description: ACTION_I18N.navigate.description,
      },
      value: '/relative/path',
    };
    expect(AdhocTestStepSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RecordedActionSchema', () => {
  it('rejects an action type the page invented', () => {
    const result = RecordedActionSchema.safeParse({
      type: 'evaluate',
      timestamp: Date.now(),
      value: 'process.exit()',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the masked flag used for secret fields', () => {
    const result = RecordedActionSchema.safeParse({
      type: 'input',
      selector: '#password',
      value: '',
      masked: true,
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a frame path and only the unsupported reasons it knows', () => {
    const ok = RecordedActionSchema.safeParse({
      type: 'click',
      selector: 'x-field input[name="city"]',
      frameSelector: 'x-frame-shell iframe[name="inner"]',
      unsupported: 'closed-shadow-root',
      timestamp: Date.now(),
    });
    expect(ok.success).toBe(true);
    const invented = RecordedActionSchema.safeParse({
      type: 'click',
      unsupported: 'whatever',
      timestamp: Date.now(),
    });
    expect(invented.success).toBe(false);
  });
});

describe('shadow DOM and frames in the mapping (P12, C11)', () => {
  it('carries the frame path into the step, beside the selector and not inside it', () => {
    const step = mapRecordedActionToStep(
      at({
        type: 'input',
        selector: 'body > x-field input[name="city"]',
        frameSelector: 'body > x-frame-shell iframe[name="inner"]',
        value: 'Torino',
      }),
      0,
    );
    expect(step?.targetElement).toMatchObject({
      selector: 'body > x-field input[name="city"]',
      frameSelector: 'body > x-frame-shell iframe[name="inner"]',
    });
    expect(AdhocTestStepSchema.safeParse(step).success).toBe(true);
  });

  it('turns no unsupported action into a step, and lists every one of them', () => {
    const sequence = [
      at({ type: 'click', selector: '#ok' }),
      at({ type: 'click', selector: 'body > x-closed', unsupported: 'closed-shadow-root' }),
      at({ type: 'input', selector: '#x', value: '1', unsupported: 'unaddressable-frame' }),
    ];
    expect(mapRecordedSequence(sequence).map((s) => s.targetElement?.selector)).toEqual(['#ok']);
    expect(unsupportedActions(sequence).map((a) => a.unsupported)).toEqual([
      'closed-shadow-root',
      'unaddressable-frame',
    ]);
  });

  it('replays a ticked box as the state it must end in, not as typed text', () => {
    const on = mapRecordedActionToStep(
      at({ type: 'input', selector: '#agree', value: 'true', inputType: 'checkbox' }),
      0,
    );
    const off = mapRecordedActionToStep(
      at({ type: 'input', selector: '#agree', value: 'false', inputType: 'checkbox' }),
      0,
    );
    expect([on?.action.id, on?.value]).toEqual(['ensureState', 'checked']);
    expect([off?.action.id, off?.value]).toEqual(['ensureState', 'unchecked']);
    // A buffer from before the field existed maps exactly as it always did.
    const legacy = mapRecordedActionToStep(
      at({ type: 'input', selector: '#agree', value: 'true' }),
      0,
    );
    expect(legacy?.action.id).toBe('input');
  });

  it('does not move an Enter behind a value typed in the same selector of another frame', () => {
    const ordered = mapRecordedSequence([
      at({ type: 'keypress', key: 'Enter', selector: 'input[name="q"]' }),
      at({ type: 'input', selector: 'input[name="q"]', value: 'x', frameSelector: 'iframe#a' }),
    ]);
    expect(ordered.map((s) => s.action.id)).toEqual(['pressKey', 'input']);
  });
});
