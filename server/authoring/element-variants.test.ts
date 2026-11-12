import { describe, it, expect } from 'vitest';
import {
  ElementVariantsSchema,
  locatorFor,
  readVariants,
  variantOf,
} from '@shared/element-variants';
import { resolveStepElements } from './step-elements';
import { elementFingerprint, provenanceOf, withTestProvenance } from './step-provenance';
import {
  DEPENDENCY_PROTOCOL,
  dependencyFingerprint,
  expandWithBundle,
  type DependencyBundle,
} from './executable-definition';
import { recordHealingProposal } from './healing-proposals';

/**
 * Locator variants (run comparison, release 3): the same element where one environment's build
 * renders it differently. An environment's `uiVariant` picks the variant; everything else keeps
 * the element's own locator, and bundles frozen before variants existed keep their fingerprint.
 */

const button = {
  id: 'el-1',
  selector: '#buy',
  frameSelector: null,
  variants: { angular22: { selector: '[data-test=buy]' } },
};

const sequence = () =>
  withTestProvenance([
    {
      id: 's1',
      action: { id: 'click', name: 'Click Buy' },
      targetElement: { selector: '#old', elementId: 'el-1' },
    },
  ]);

const target = (steps: unknown[]) =>
  (steps[0] as { targetElement: { selector: string } }).targetElement.selector;

describe('choosing a variant', () => {
  it('reads the variant from the run variables, ignoring a blank one', () => {
    expect(variantOf({ uiVariant: ' angular22 ' })).toBe('angular22');
    expect(variantOf({ uiVariant: '' })).toBeNull();
    expect(variantOf({})).toBeNull();
    expect(variantOf(undefined)).toBeNull();
  });

  it("uses the variant's locator when the element has it, its own otherwise", () => {
    expect(locatorFor(button, 'angular22')).toEqual({
      selector: '[data-test=buy]',
      frameSelector: null,
      variant: 'angular22',
    });
    expect(locatorFor(button, 'react')).toMatchObject({ selector: '#buy', variant: null });
    expect(locatorFor(button, null)).toMatchObject({ selector: '#buy', variant: null });
  });

  it('drops a malformed stored variant and validates what is written', () => {
    expect(readVariants({ a: { selector: '' }, b: 'x', c: { selector: '#c' } })).toEqual({
      c: { selector: '#c', frameSelector: null },
    });
    expect(readVariants(null)).toEqual({});
    expect(ElementVariantsSchema.safeParse({ ok: { selector: '#a' } }).success).toBe(true);
    expect(ElementVariantsSchema.safeParse({ 'bad name': { selector: '#a' } }).success).toBe(false);
    expect(ElementVariantsSchema.safeParse({ ok: { selector: '' } }).success).toBe(false);
  });
});

describe('resolving a step through a variant', () => {
  it('runs the variant and records it, with the fingerprint of what ran', () => {
    const { steps } = resolveStepElements(sequence(), [button], 'angular22');
    expect(target(steps)).toBe('[data-test=buy]');
    expect(provenanceOf(steps[0])?.element).toEqual({
      id: 'el-1',
      fingerprint: elementFingerprint({ selector: '[data-test=buy]', frameSelector: null }),
      variant: 'angular22',
    });
  });

  it("keeps the element's own locator for a run without the variant", () => {
    const { steps } = resolveStepElements(sequence(), [button]);
    expect(target(steps)).toBe('#buy');
    expect(provenanceOf(steps[0])?.element).not.toHaveProperty('variant');
  });
});

describe('the frozen bundle', () => {
  const bundle = (variants?: Record<string, { selector: string }>) => {
    const rest: Omit<DependencyBundle, 'fingerprint'> = {
      protocol: DEPENDENCY_PROTOCOL,
      groups: [],
      elements: [
        {
          id: 'el-1',
          name: 'Buy',
          projectId: 1,
          selector: '#buy',
          frameSelector: null,
          updatedAt: null,
          ...(variants ? { variants } : {}),
        },
      ],
      customActions: [],
      missing: { groups: [], elements: [], customActions: [] },
    };
    return { ...rest, fingerprint: dependencyFingerprint(rest) };
  };

  it('keeps the fingerprint of a bundle without variants, and changes with one', () => {
    expect(bundle({}).fingerprint).toBe(bundle().fingerprint);
    expect(bundle({ angular22: { selector: '[data-test=buy]' } }).fingerprint).not.toBe(
      bundle().fingerprint,
    );
  });

  it('resolves the variant from the bundle alone', () => {
    const frozen = bundle({ angular22: { selector: '[data-test=buy]' } });
    expect(target(expandWithBundle(sequence(), frozen, 'angular22').steps)).toBe('[data-test=buy]');
    expect(target(expandWithBundle(sequence(), frozen).steps)).toBe('#buy');
  });
});

describe('healing a step that ran through a variant', () => {
  it("does not propose rewriting the element's own locator", async () => {
    const { steps } = resolveStepElements(sequence(), [button], 'angular22');
    const healing = await recordHealingProposal({
      step: { provenance: provenanceOf(steps[0]), elementId: 'el-1', testId: 1 },
      selector: '[data-test=buy-now]',
    } as unknown as Parameters<typeof recordHealingProposal>[0]);
    expect(JSON.stringify(healing)).toContain('locator variant');
  });
});
