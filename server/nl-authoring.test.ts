import { describe, it, expect, vi } from 'vitest';
import {
  authorSteps,
  buildCatalogue,
  buildPrompt,
  buildStep,
  labelForDetected,
  normaliseLabel,
  parseLine,
  parseModelResponse,
  resolveTarget,
  splitInstructions,
} from './nl-authoring';

/**
 * A test written by describing it.
 *
 * The whole risk of this feature is a sentence that becomes the wrong step and is then
 * believed — a test that passes for a reason nobody intended is worse than no test. So what
 * these hold is mostly refusals: an element nobody can identify, a value an action does not
 * accept, a model answering about something it was not asked. Every one of those must come
 * back as a named problem, never as a step.
 */

const detected = [
  { id: 'd1', type: 'button', selector: '#save', tag: 'button', text: 'Save', attributes: {} },
  { id: 'd2', type: 'input', selector: '#user', tag: 'input', text: '', attributes: { placeholder: 'Username' } },
  { id: 'd3', type: 'select', selector: '#country', tag: 'select', text: '', attributes: { name: 'country' } },
  { id: 'd4', type: 'checkbox', selector: '#terms', tag: 'input', text: 'Accept terms', attributes: {} },
];

const catalogue = buildCatalogue({ detected });

describe('splitInstructions', () => {
  it('numbers the lines a person wrote, not the blank ones between them', () => {
    const lines = splitInstructions('Click Save\n\n  \nClick Save again\n');

    expect(lines).toEqual([
      { line: 1, text: 'Click Save' },
      { line: 2, text: 'Click Save again' },
    ]);
  });

  it('reads a numbered or bulleted list as the list it looks like', () => {
    const lines = splitInstructions('1. Click Save\n- Click Cancel\n• Click Close');

    expect(lines.map((item) => item.text)).toEqual(['Click Save', 'Click Cancel', 'Click Close']);
  });
});

describe('normaliseLabel', () => {
  it('ignores the things two people would not agree on', () => {
    expect(normaliseLabel('  The "Save" Button. ')).toBe('save button');
  });

  it('keeps a word that is only an article by accident', () => {
    expect(normaliseLabel('La')).toBe('la');
  });
});

describe('labelForDetected', () => {
  it('names an element after what the page shows', () => {
    expect(labelForDetected(detected[0], 0)).toBe('Save button');
  });

  it('falls back to the placeholder when there is no text', () => {
    expect(labelForDetected(detected[1], 1)).toBe('Username input');
  });

  it('still names an element that says nothing about itself', () => {
    expect(labelForDetected({ selector: 'div > span', tag: 'span', attributes: {} }, 6)).toBe('span 7');
  });
});

describe('parseLine', () => {
  it('reads the ordinary imperatives', () => {
    expect(parseLine('Click the Save button')).toMatchObject({ action: 'click', targetPhrase: 'the Save button' });
    expect(parseLine('Hover over the Save button')).toMatchObject({ action: 'hover' });
    expect(parseLine('Go to https://example.test')).toMatchObject({ action: 'navigate', value: 'https://example.test' });
  });

  it('reads them in Italian too', () => {
    expect(parseLine('Clicca su Salva')).toMatchObject({ action: 'click', targetPhrase: 'Salva' });
    expect(parseLine('Inserisci "mario" nel campo Username')).toMatchObject({ action: 'input', value: 'mario' });
    expect(parseLine('Verifica che il totale contenga "42"')).toMatchObject({ action: 'assertTextContains', value: '42' });
  });

  it('reads a bare number as seconds, because nobody means two milliseconds', () => {
    expect(parseLine('Wait 2')).toMatchObject({ action: 'wait', value: '2000' });
    expect(parseLine('Wait 500 ms')).toMatchObject({ action: 'wait', value: '500' });
  });

  it('prefers the conditional wait over the pause, when the sentence says what it waits for', () => {
    // "wait for the grid to be visible" read as a pause would be a step that waits for a
    // number it does not have, and the specific rule has to win for that not to happen.
    expect(parseLine('Wait for the grid to be visible')).toMatchObject({
      action: 'waitForElement',
      value: 'visible',
    });
  });

  it('tells reading a state apart from bringing one about', () => {
    // The same control, the same word, two different steps: "check that" asserts, and a
    // second run of a test that asserted is unchanged. "Make sure" is a precondition, and a
    // click on an already-ticked box would undo it.
    expect(parseLine('Check that the terms checkbox is checked')).toMatchObject({ action: 'assertState' });
    expect(parseLine('Make sure the terms checkbox is checked')).toMatchObject({ action: 'ensureState' });
  });

  it('says nothing about a sentence it does not recognise', () => {
    expect(parseLine('Log in as an administrator and look around')).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('finds the element a person named', () => {
    const resolution = resolveTarget('the Save button', catalogue);

    expect(resolution.ok && resolution.entry.selector).toBe('#save');
  });

  it('finds it when the kind of control was named differently', () => {
    const resolution = resolveTarget('Save', catalogue);

    expect(resolution.ok && resolution.entry.selector).toBe('#save');
  });

  it('refuses an ambiguous name instead of picking the first one', () => {
    const twoSaves = buildCatalogue({
      detected: [
        { selector: '#save-draft', tag: 'button', text: 'Save', attributes: {} },
        { selector: '#save-all', tag: 'button', text: 'Save', attributes: {} },
      ],
    });

    const resolution = resolveTarget('Save', twoSaves);

    expect(resolution.ok).toBe(false);
    expect(!resolution.ok && resolution.reason).toContain('matches 2 elements');
  });

  it('says what to do when it finds nothing', () => {
    const resolution = resolveTarget('Delete everything', catalogue);

    expect(resolution.ok).toBe(false);
    expect(!resolution.ok && resolution.reason).toContain('element repository');
  });
});

describe('buildStep', () => {
  it('builds a step the rest of the system would accept', () => {
    const built = buildStep({ action: 'click', targetPhrase: 'Save' }, catalogue);

    expect(built.ok).toBe(true);
    expect(built.ok && built.step.action.id).toBe('click');
    expect(built.ok && built.step.targetElement?.selector).toBe('#save');
    // The palette's i18n key, not an English string: a step made from a sentence is labelled
    // by the same table as one dragged in by hand.
    expect(built.ok && built.step.action.name).toBe('dashboardPageNew.actions.click.name');
  });

  it('drives a native select by its option and anything else by clicking it open', () => {
    const native = buildStep({ action: 'select', targetPhrase: 'country', value: 'Italy' }, catalogue);
    const material = buildStep(
      { action: 'select', targetPhrase: 'Country', value: 'Italy' },
      buildCatalogue({ detected: [{ selector: 'mat-select#country', tag: 'mat-select', text: 'Country', attributes: {} }] }),
    );

    expect(native.ok && native.step.action.id).toBe('select');
    // A Material dropdown is a div and an overlay; selectOption cannot drive it, and the
    // author should not have to know that.
    expect(material.ok && material.step.action.id).toBe('selectByText');
  });

  it('refuses a value the action does not accept', () => {
    const built = buildStep({ action: 'assertState', targetPhrase: 'terms', value: 'greenish' }, catalogue);

    expect(built.ok).toBe(false);
    expect(!built.ok && built.reason).toContain('checked');
  });

  it('refuses an action nobody implements', () => {
    const built = buildStep({ action: 'teleport' as any, targetPhrase: 'Save' }, catalogue);

    expect(built.ok).toBe(false);
  });

  it('completes a URL somebody wrote the way people write them', () => {
    const built = buildStep({ action: 'navigate', value: 'example.test/login' }, catalogue);

    expect(built.ok && built.step.value).toBe('https://example.test/login');
  });

  it('points a step at the repository, so a later repair reaches it', () => {
    const shared = buildCatalogue({
      repository: [{ id: 'elem-1', name: 'Save button', selector: '#save', tag: 'button' }],
    });

    const built = buildStep({ action: 'click', targetPhrase: 'Save button' }, shared);

    expect(built.ok && (built.step.targetElement as any).elementId).toBe('elem-1');
  });

  it('refuses a model’s element key that is not in the catalogue', () => {
    // The one thing a model must never be able to do: name something that does not exist and
    // have a selector invented for it.
    const built = buildStep({ action: 'click', targetKey: 'D99' }, catalogue);

    expect(built.ok).toBe(false);
  });
});

describe('buildPrompt', () => {
  it('tells the model the actions and the element keys, and no selectors', () => {
    const prompt = buildPrompt([{ line: 1, text: 'Sign in' }], catalogue);

    expect(prompt).toContain('assertElementCount');
    expect(prompt).toContain('D1: Save button');
    expect(prompt).not.toContain('#save');
  });
});

describe('parseModelResponse', () => {
  const allowed = new Set([1, 2]);

  it('reads a fenced answer', () => {
    const proposals = parseModelResponse('```json\n[{"line":1,"action":"click","element":"D1"}]\n```', allowed);

    expect(proposals.get(1)).toMatchObject({ action: 'click', targetKey: 'D1' });
  });

  it('drops an answer about a line nobody asked about', () => {
    const proposals = parseModelResponse('[{"line":9,"action":"click","element":"D1"}]', allowed);

    expect(proposals.size).toBe(0);
  });

  it('drops an invented action', () => {
    const proposals = parseModelResponse('[{"line":1,"action":"hack","element":"D1"}]', allowed);

    expect(proposals.size).toBe(0);
  });

  it('returns nothing at all for prose', () => {
    expect(parseModelResponse('I think you should click Save.', allowed).size).toBe(0);
    expect(parseModelResponse(null, allowed).size).toBe(0);
  });
});

describe('authorSteps', () => {
  it('turns a description into a sequence, in the order it was written', async () => {
    const result = await authorSteps({
      text: [
        'Go to https://example.test/login',
        'Type "mario" into the Username field',
        'Click the Save button',
        'Check that the Save button is visible',
      ].join('\n'),
      detected,
    });

    expect(result.unresolved).toEqual([]);
    expect(result.steps.map((item) => item.step.action.id)).toEqual(['navigate', 'input', 'click', 'assert']);
    expect(result.steps.map((item) => item.line)).toEqual([1, 2, 3, 4]);
  });

  it('never asks a model about a sentence it already understood', async () => {
    const propose = vi.fn().mockResolvedValue('[]');

    const result = await authorSteps({ text: 'Click the Save button', detected }, { propose });

    expect(propose).not.toHaveBeenCalled();
    expect(result.usedModel).toBe(false);
    expect(result.steps[0].source).toBe('pattern');
  });

  it('asks the model only about the leftovers, and keeps the rest', async () => {
    const propose = vi.fn().mockResolvedValue('[{"line":2,"action":"click","element":"D1"}]');

    const result = await authorSteps(
      { text: 'Click the Save button\nFinalise the order', detected },
      { propose },
    );

    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose.mock.calls[0][0]).toContain('2. Finalise the order');
    expect(propose.mock.calls[0][0]).not.toContain('Click the Save button');
    expect(result.steps.map((item) => item.source)).toEqual(['pattern', 'model']);
  });

  it('accounts for every line it could not read', async () => {
    const result = await authorSteps({ text: 'Click the Save button\nDo the needful', detected });

    expect(result.steps).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({ line: 2, text: 'Do the needful' });
  });

  it('keeps what it read when the model fails', async () => {
    // A model that is down degrades the feature to the phrasings the parser knows. It does
    // not fail the request, and it does not lose the steps that never needed it.
    const propose = vi.fn().mockRejectedValue(new Error('503'));

    const result = await authorSteps({ text: 'Click the Save button\nDo the needful', detected }, { propose });

    expect(result.steps).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
  });

  it('says a step needs an element it cannot find, rather than inventing one', async () => {
    const result = await authorSteps({ text: 'Click the Publish button', detected });

    expect(result.steps).toEqual([]);
    expect(result.unresolved[0].reason).toContain('Publish button');
  });
});
