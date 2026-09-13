import { describe, it, expect } from 'vitest';
import { isVolatileId, VOLATILE_ID_PATTERNS } from '@shared/selectors';
import { RECORDER_SCRIPT } from './recorder-script';

/**
 * The rule that decides whether an id is worth building a selector out of.
 *
 * The cases below are not invented: they are the ids that came back from recording one walk
 * through DMO's plant configuration and operator console — 11 of 24 steps anchored on one of
 * them. Detection already rejected these; the recorder did not, and a recording is the one
 * path where a bad selector is saved and replayed rather than merely displayed.
 */

describe('ids a framework generated', () => {
  it('rejects the ones Angular Material and the CDK hand out', () => {
    // Straight from the recording. cdk-overlay-N is the worst of them: the number counts
    // overlays opened in that browsing session, so it differs on the very next run — the
    // same walk produced cdk-overlay-0 early on and cdk-overlay-18 near the end.
    for (const id of [
      'cdk-overlay-0',
      'cdk-overlay-18',
      'mat-input-0',
      'mat-tab-label-0-2',
      'mat-tab-label-4-2',
      'mat-tab-content-4-2',
      'mat-select-value-5',
      'mdc-checkbox-3',
      'ng-select-12',
    ]) {
      expect({ id, volatile: isVolatileId(id) }).toEqual({ id, volatile: true });
    }
  });

  it('rejects generated ids that carry no framework prefix', () => {
    expect(isVolatileId(':r1a:')).toBe(true); // React useId / Radix
    expect(isVolatileId('a3f91c2e7b4d')).toBe(true); // a bundler hash
    expect(isVolatileId('field-184392')).toBe(true); // mostly a long number
  });

  it('keeps the ids a developer wrote', () => {
    // The rule is only useful if it leaves the good ones alone: rejecting everything would
    // push every selector onto a structural path, which is the outcome it exists to avoid.
    for (const id of [
      'host-container',
      'login-button',
      'equipment-tree',
      'save',
      'tab2', // a small trailing number is a developer's counting, not a framework's
      'matrixView', // starts with "mat" but has no separator, so not a Material id
    ]) {
      expect({ id, volatile: isVolatileId(id) }).toEqual({ id, volatile: false });
    }
  });
});

describe('the recorder and the detector use one rule', () => {
  it('the injected script carries the shared patterns rather than its own copy', () => {
    // The two cannot import from each other at runtime — one is serialised by Playwright,
    // the other is a string injected into the page — so the guard is that the patterns
    // reach the script as data. If someone writes a second copy, this fails.
    for (const pattern of VOLATILE_ID_PATTERNS) {
      expect(RECORDER_SCRIPT).toContain(JSON.stringify(pattern).slice(1, -1));
    }
  });

  it('the script no longer takes an id before looking for a test id', () => {
    // Ordering, not just filtering: `data-testid` is something someone wrote down on
    // purpose, and an id can be an accident of the framework.
    // The call site, not the helper's definition — which sits above it and would make this
    // pass for the wrong reason.
    const testIdAt = RECORDER_SCRIPT.indexOf("getAttribute('data-testid')");
    const ownIdAt = RECORDER_SCRIPT.indexOf('var ownId = usableId(el)');

    expect(testIdAt).toBeGreaterThan(-1);
    expect(ownIdAt).toBeGreaterThan(-1);
    expect(testIdAt).toBeLessThan(ownIdAt);
  });
});
