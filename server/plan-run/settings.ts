/** How a run behaves around its tests: what it records, its policies, and visual comparison. */
import type { EvidenceCaptureMode } from '@shared/schema';
import { shouldRecord } from '../runtime/run-evidence';
import { describePolicies, runPoliciesFrom, type RunPolicies } from '../runtime/run-policies';
import { emit, type PlanRun } from './context';
import type { RunInputs } from './inputs';

export interface RunSettings {
  /**
   * Whether this run keeps a video and a trace of itself.
   *
   * Undefined when the plan wants neither, so a run that records nothing does not even build
   * the option — which is every plan until somebody turns it on.
   */
  evidence:
    | { video?: EvidenceCaptureMode; trace?: EvidenceCaptureMode; network?: EvidenceCaptureMode }
    | undefined;
  policies: RunPolicies;
  visual: { enabled: boolean; updateBaselines: boolean };
}

/** Reads the run's settings off its snapshot, and says on the console what they are. */
export function announceSettings(run: PlanRun, { snapshot }: RunInputs): RunSettings {
  const networkMode = snapshot.evidence.network ?? 'never';
  const evidence =
    shouldRecord(snapshot.evidence.video) ||
    shouldRecord(snapshot.evidence.trace) ||
    shouldRecord(networkMode)
      ? { video: snapshot.evidence.video, trace: snapshot.evidence.trace, network: networkMode }
      : undefined;
  if (evidence) {
    emit(run, {
      level: 'info',
      message:
        `Recording this run: video ${evidence.video}, trace ${evidence.trace}, network ${evidence.network}. ` +
        `Kept files appear on each result in the report.`,
      metadata: { ...evidence },
    });
  }

  const policies = runPoliciesFrom(snapshot);
  emit(run, { level: 'info', message: describePolicies(policies) });
  for (const setting of policies.notApplied) {
    emit(run, { level: 'warn', message: `${setting} has no effect on this run.` });
  }

  const visual = {
    enabled: snapshot.visualTesting.enabled,
    updateBaselines: snapshot.visualTesting.updateBaselines,
  };
  if (visual.enabled) {
    emit(run, {
      level: 'info',
      message: visual.updateBaselines
        ? 'Visual testing: this run replaces the stored baselines with its own screenshots.'
        : 'Visual testing: each step is compared against its stored baseline; a first run records one.',
    });
  }
  return { evidence, policies, visual };
}
