import { describe, it, expect } from 'vitest';
import {
  ACTION_I18N,
  ADHOC_ACTION_IDS,
  RECORDED_TYPE_TO_ACTION_ID,
  RECORDED_ACTION_TYPES,
  RecordedActionSchema,
  mapRecordedActionToStep,
  mapRecordedSequence,
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

  it('drops keypress, which has no replay counterpart', () => {
    expect(mapRecordedActionToStep(at({ type: 'keypress', key: 'Enter' }), 0)).toBeNull();
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
});
