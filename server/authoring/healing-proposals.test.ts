import { beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  healingProposals,
  projectElements,
  projectMembers,
  projects,
  stepGroups,
  testVersions,
  tests,
} from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { runWithTenant } from '../platform/middleware/tenancy';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { prepareSequence } from './executable-definition';
import { elementIdOfStep } from './step-elements';
import { provenanceOf } from './step-provenance';
import {
  HealingProposalError,
  approveHealingProposal,
  domForModel,
  knownFallbacks,
  parseLocatorAnswer,
  recordHealingProposal,
  rejectHealingProposal,
  type ProposalInput,
} from './healing-proposals';

/**
 * Healing as a proposal, approved by a person (M02, P13).
 *
 * A run used to write the repaired locator into the test, its group or the shared element while
 * it ran, as the system. These hold the new rule against the in-memory database: a run records a
 * proposal and writes nothing else; approving is an editor's act on the project, audited and
 * versioned, guarded by the fingerprint the run read; a source that changed makes the proposal
 * stale instead of being overwritten.
 */

const click = (id: string, selector: string, extra: Record<string, unknown> = {}) => ({
  id,
  action: { id: 'click', name: `Click ${id}` },
  targetElement: { selector, ...extra },
});
const call = (id: string, groupId: string) => ({
  id,
  action: { id: 'callGroup', name: 'Call' },
  value: groupId,
});

let organizationId: number;
let editorId: number;
let viewerId: number;
let projectId: number;
const editor = () => ({ id: editorId, username: 'heal-editor' });
const asEditor = <T>(fn: () => Promise<T>) =>
  runWithTenant(organizationId, fn, { userId: editorId, role: 'editor' });

beforeAll(async () => {
  organizationId = await createTestOrganization('Healing Proposals Org');
  editorId = await createTestUser(organizationId, `heal-editor-${uuidv4().slice(0, 6)}`);
  viewerId = await createTestUser(organizationId, `heal-viewer-${uuidv4().slice(0, 6)}`);
  const [project] = await privilegedDb
    .insert(projects)
    .values({ name: 'Healing App', userId: editorId, organizationId })
    .returning();
  projectId = project.id;
});

async function seedTest(sequence: unknown[], extra: Partial<typeof tests.$inferInsert> = {}) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({
      userId: editorId,
      organizationId,
      projectId,
      name: `Heal ${uuidv4().slice(0, 4)}`,
      url: '',
      sequence,
      elements: [],
      ...extra,
    })
    .returning();
  return row;
}
async function seedGroup(sequence: unknown[]) {
  const id = uuidv4();
  await privilegedDb.insert(stepGroups).values({
    id,
    organizationId,
    userId: editorId,
    projectId,
    name: `G ${id.slice(0, 4)}`,
    sequence,
  });
  return id;
}
const testRow = async (id: number) =>
  (await privilegedDb.select().from(tests).where(eq(tests.id, id)))[0];
const proposalRow = async (id: string) =>
  (await privilegedDb.select().from(healingProposals).where(eq(healingProposals.id, id)))[0];
const audits = (action: string, targetId: string | number) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, String(targetId))));
const versionsOf = (testId: number) =>
  privilegedDb.select().from(testVersions).where(eq(testVersions.testId, testId));
const selectorsOf = (sequence: unknown) =>
  (sequence as Array<{ targetElement?: { selector: string } }>).map(
    (s) => s.targetElement?.selector,
  );

/** What the runner hands the proposal for the prepared step at `at`. */
async function healed(
  testId: number,
  sequence: unknown[],
  at: number,
  selector: string,
  extra: Partial<ProposalInput> = {},
): Promise<ProposalInput> {
  const prepared = await runWithTenant(organizationId, () => prepareSequence(sequence));
  const step = prepared.steps[at];
  return {
    step: { testId, provenance: provenanceOf(step), elementId: elementIdOfStep(step) },
    executionId: 'exec-p13',
    attempt: null,
    stepIndex: at,
    selector,
    origin: 'fallback',
    ...extra,
  };
}
const record = (input: ProposalInput) =>
  runWithTenant(organizationId, () => recordHealingProposal(input));

describe('the locator the model answers with', () => {
  it('keeps every locator that legitimately contains "css"', () => {
    expect(parseLocatorAnswer('css=.btn')).toBe('css=.btn');
    expect(parseLocatorAnswer('.css-button > span')).toBe('.css-button > span');
    expect(parseLocatorAnswer('```css-grid > a```')).toBe('css-grid > a');
    expect(parseLocatorAnswer('```css\n.css-button\n```')).toBe('.css-button');
    expect(parseLocatorAnswer('```\ncss=#save\n```')).toBe('css=#save');
    expect(parseLocatorAnswer('`[data-css="x"]`')).toBe('[data-css="x"]');
  });

  it('is nothing when the answer is not one locator', () => {
    expect(parseLocatorAnswer('')).toBeNull();
    expect(parseLocatorAnswer('Here you go:\n#save')).toBeNull();
    expect(parseLocatorAnswer('```css\n\n```')).toBeNull();
    expect(parseLocatorAnswer('x'.repeat(2001))).toBeNull();
  });
});

describe('known fallbacks', () => {
  it('come from what the recording kept, most deliberate first, never from a template', () => {
    expect(
      knownFallbacks(
        {
          tag: 'BUTTON',
          attributes: {
            id: 'save',
            name: 'save-btn',
            'data-testid': 'save "now"',
            'aria-label': '{{label}}',
            value: 'secret',
          },
        },
        '#gone',
      ),
    ).toEqual(['button[data-testid="save \\"now\\""]', '#save', 'button[name="save-btn"]']);
  });

  it('never offers the locator that just failed, and nothing without attributes', () => {
    expect(knownFallbacks({ attributes: { id: 'save' } }, '#save')).toEqual([]);
    expect(knownFallbacks(null, '#x')).toEqual([]);
  });
});

describe('what the model is shown', () => {
  it('has no scripts, no form values, no tokens', () => {
    const page =
      '<head><meta name="csrf-token" content="tok-123"><script>var s="k"</script></head>' +
      '<input type="hidden" name="csrf" value="tok-456"><input id=pw value=hunter2>' +
      '<textarea name="notes">private</textarea><button id="save">Save</button>';
    const shown = domForModel(page);
    for (const value of ['tok-123', 'tok-456', 'hunter2', 'private', 'var s']) {
      expect(shown).not.toContain(value);
    }
    expect(shown).toContain('<button id="save">Save</button>');
    expect(shown).toContain('name="csrf"');
  });

  it('leaves no script behind odd end tags, nested pieces or a script never closed', () => {
    const shown = domForModel(
      '<p>a</p><script>x1</script\t\n bar><scr<script>x2</script>ipt>x3</script>' +
        '<style>x4</style ><b>b</b><script>x5',
    );
    for (const value of ['x1', 'x2', 'x3', 'x4', 'x5', '<script', '<style']) {
      expect(shown).not.toContain(value);
    }
    expect(shown).toBe('<p>a</p><b>b</b>');
  });
});

describe('a run records a proposal and writes nothing else', () => {
  it('records run, step, source fingerprint and the locator as written, unresolved', async () => {
    const sequence = [click('t1', '#{{field}}'), click('t2', '#third')];
    const test = await seedTest(sequence);
    const outcome = await record(await healed(test.id, sequence, 0, '#second'));

    expect(outcome).toMatchObject({
      status: 'proposed',
      originalSelector: '#{{field}}',
      proposedSelector: '#second',
      origin: 'fallback',
      target: { kind: 'test', index: 0, stepId: 't1' },
    });
    const row = await proposalRow(outcome.proposalId!);
    expect(row).toMatchObject({
      status: 'proposed',
      testId: test.id,
      projectId,
      executionId: 'exec-p13',
      targetKind: 'test',
      targetRef: String(test.id),
      targetIndex: 0,
      selectorBefore: '#{{field}}',
      selectorAfter: '#second',
      decidedBy: null,
    });
    expect(row.sourceFingerprint).toBe(outcome.fingerprint);
    // Nothing persistent beyond the proposal: same steps, no version, no audit entry.
    expect((await testRow(test.id)).sequence).toEqual(sequence);
    expect(await versionsOf(test.id)).toHaveLength(0);
    expect(await audits('test.selector_healed', test.id)).toHaveLength(0);
  });

  it('names the unit and attempt of a plan run', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const planId = uuidv4();
    const executionId = uuidv4();
    const unitId = 'u_' + 'a'.repeat(24);
    await privilegedDb.execute(
      sql`INSERT INTO test_plans (id, name, user_id, organization_id) VALUES (${planId}, 'P13', ${editorId}, ${organizationId})`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO test_plan_executions (id, organization_id, test_plan_id, status, triggered_by) VALUES (${executionId}, ${organizationId}, ${planId}, 'running', 'manual')`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO execution_units (execution_id, organization_id, unit_id, position, coordinates) VALUES (${executionId}, ${organizationId}, ${unitId}, 0, '{}'::jsonb)`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO execution_unit_attempts (execution_id, organization_id, unit_id, attempt) VALUES (${executionId}, ${organizationId}, ${unitId}, 2)`,
    );
    const outcome = await record(
      await healed(test.id, sequence, 0, '#second', {
        executionId,
        attempt: { executionId, unitId, attempt: 2 },
      }),
    );
    expect(await proposalRow(outcome.proposalId!)).toMatchObject({
      executionId,
      unitId,
      attempt: 2,
    });

    // An attempt that is not in the run's manifest is refused, and the step says it was not kept.
    const unknown = await record(
      await healed(test.id, sequence, 0, '#third', {
        executionId,
        attempt: { executionId, unitId, attempt: 9 },
      }),
    );
    expect(unknown).toMatchObject({ status: 'unrecorded', reason: 'failed' });
  });

  it('joins the open proposal when another run heals the same step the same way', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const first = await record(await healed(test.id, sequence, 0, '#second'));
    const second = await record(await healed(test.id, sequence, 0, '#second'));
    expect(second.proposalId).toBe(first.proposalId);
    const rows = await privilegedDb
      .select()
      .from(healingProposals)
      .where(eq(healingProposals.testId, test.id));
    expect(rows).toHaveLength(1);
  });

  it('says why nothing was recorded for a step with no provenance', async () => {
    const outcome = await record({
      step: { testId: 1, provenance: null, elementId: null },
      executionId: null,
      attempt: null,
      stepIndex: 3,
      selector: '#x',
      origin: 'ai',
    });
    expect(outcome).toMatchObject({ status: 'unrecorded', reason: 'no_source' });
  });
});

describe('approving', () => {
  it("writes the test's working copy as a new version in the approver's name, not the published one", async () => {
    const sequence = [click('t1', '#first'), click('t2', '#gone')];
    const test = await seedTest(sequence, { publishedVersion: 1 });
    await privilegedDb.insert(testVersions).values({
      organizationId,
      testId: test.id,
      version: 1,
      name: test.name,
      url: '',
      sequence,
      elements: [],
      summary: 'Created.',
    });
    const proposal = await record(await healed(test.id, sequence, 1, '#second'));

    const decision = await asEditor(() =>
      approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()),
    );

    expect(decision).toMatchObject({
      unchanged: false,
      proposal: { status: 'approved', decidedBy: editorId, appliedVersion: 2 },
    });
    const row = await testRow(test.id);
    expect(selectorsOf(row.sequence)).toEqual(['#first', '#second']);
    expect(row.publishedVersion).toBe(1);
    const versions = await versionsOf(test.id);
    expect(versions.find((v) => v.version === 2)?.createdBy).toBe(editorId);
    const [approved] = await audits('healing_proposal.approved', proposal.proposalId!);
    expect(approved).toMatchObject({ actorUserId: editorId });
    expect(approved.metadata).toMatchObject({ testId: test.id, step: 2, version: 2 });
    const [healedEntry] = await audits('test.selector_healed', test.id);
    expect(healedEntry).toMatchObject({ actorUserId: editorId });
    expect(healedEntry.metadata).toMatchObject({ proposalId: proposal.proposalId });
    // The audit says who, where and from which run, never the locators.
    expect(JSON.stringify([approved.metadata, healedEntry.metadata])).not.toContain('#second');
  });

  it('is idempotent: approving again changes nothing more', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));
    const approve = () =>
      asEditor(() => approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()));

    await approve();
    const again = await approve();

    expect(again).toMatchObject({ unchanged: true, proposal: { status: 'approved' } });
    expect(await versionsOf(test.id)).toHaveLength(1);
    expect(await audits('healing_proposal.approved', proposal.proposalId!)).toHaveLength(1);
  });

  it("repairs the group's step and leaves the test that calls it untouched", async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#gone')]);
    const sequence = [call('c1', group), click('t2', '#third')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 1, '#second'));
    expect(proposal.target).toMatchObject({ kind: 'group', index: 1, stepId: 'g2' });

    await asEditor(() =>
      approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()),
    );

    const [stored] = await privilegedDb.select().from(stepGroups).where(eq(stepGroups.id, group));
    expect(selectorsOf(stored.sequence)).toEqual(['#first', '#second']);
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });

  it('repairs a shared element in the repository', async () => {
    const elementId = uuidv4();
    await privilegedDb
      .insert(projectElements)
      .values({ id: elementId, organizationId, projectId, name: 'Save', selector: '#gone' });
    const sequence = [click('t1', '#gone', { elementId })];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));
    expect(proposal).toMatchObject({ originalSelector: '#gone', target: { kind: 'element' } });

    await asEditor(() =>
      approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()),
    );

    const [element] = await privilegedDb
      .select()
      .from(projectElements)
      .where(eq(projectElements.id, elementId));
    expect(element).toMatchObject({ selector: '#second', originalSelector: '#gone' });
  });

  it('turns stale, writing nothing, when the step changed after the run read it', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));
    const edited = [{ ...sequence[0], value: 'edited' }];
    await privilegedDb.update(tests).set({ sequence: edited }).where(eq(tests.id, test.id));

    const decision = await asEditor(() =>
      approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()),
    );

    expect(decision).toMatchObject({ conflict: 'changed', proposal: { status: 'stale' } });
    expect((await proposalRow(proposal.proposalId!)).status).toBe('stale');
    expect((await testRow(test.id)).sequence).toEqual(edited);
    expect(await versionsOf(test.id)).toHaveLength(0);
    // And a stale proposal stays refused.
    await expect(
      asEditor(() => approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor())),
    ).rejects.toMatchObject({ status: 409, code: 'proposal_stale' });
  });

  it('makes the other open proposals for the same step stale once one is approved', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const one = await record(await healed(test.id, sequence, 0, '#second'));
    const other = await record(await healed(test.id, sequence, 0, '#third', { origin: 'ai' }));
    expect(other.proposalId).not.toBe(one.proposalId);

    await asEditor(() => approveHealingProposal(one.proposalId!, one.fingerprint!, editor()));

    expect((await proposalRow(other.proposalId!)).status).toBe('stale');
    await expect(
      asEditor(() => approveHealingProposal(other.proposalId!, other.fingerprint!, editor())),
    ).rejects.toBeInstanceOf(HealingProposalError);
    expect(selectorsOf((await testRow(test.id)).sequence)).toEqual(['#second']);
  });

  it('refuses a fingerprint other than the one the proposal was recorded with', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));

    await expect(
      asEditor(() => approveHealingProposal(proposal.proposalId!, 'f'.repeat(64), editor())),
    ).rejects.toMatchObject({ status: 409, code: 'fingerprint_mismatch' });
    expect((await proposalRow(proposal.proposalId!)).status).toBe('proposed');
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });

  it('is refused to a viewer of a restricted project, who can still see the proposal', async () => {
    const [restricted] = await privilegedDb
      .insert(projects)
      .values({ name: 'Restricted', userId: editorId, organizationId, restricted: true })
      .returning();
    await privilegedDb
      .insert(projectMembers)
      .values({ projectId: restricted.id, userId: viewerId, organizationId, role: 'viewer' });
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence, { projectId: restricted.id });
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));

    await expect(
      runWithTenant(
        organizationId,
        () =>
          approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, {
            id: viewerId,
            username: 'viewer',
          }),
        { userId: viewerId, role: 'editor' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'project_read_only' });
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });
});

describe('rejecting', () => {
  it('writes nothing, is idempotent, and cannot be approved afterwards', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));

    const first = await asEditor(() =>
      rejectHealingProposal(proposal.proposalId!, 'Wrong button', editor()),
    );
    const again = await asEditor(() => rejectHealingProposal(proposal.proposalId!, null, editor()));

    expect(first).toMatchObject({
      unchanged: false,
      proposal: { status: 'rejected', reason: 'Wrong button', decidedBy: editorId },
    });
    expect(again.unchanged).toBe(true);
    expect(await audits('healing_proposal.rejected', proposal.proposalId!)).toHaveLength(1);
    await expect(
      asEditor(() => approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor())),
    ).rejects.toMatchObject({ status: 409, code: 'proposal_rejected' });
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });

  it('is refused for an approved proposal: taking it back is restoring the version before', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const proposal = await record(await healed(test.id, sequence, 0, '#second'));
    await asEditor(() =>
      approveHealingProposal(proposal.proposalId!, proposal.fingerprint!, editor()),
    );
    await expect(
      asEditor(() => rejectHealingProposal(proposal.proposalId!, null, editor())),
    ).rejects.toMatchObject({ status: 409, code: 'proposal_approved' });
  });
});
