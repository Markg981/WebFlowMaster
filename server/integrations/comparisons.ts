import { createCompareRuns } from '../reporting/comparison/compare-runs';
import { createComparisonOrchestrator } from '../execution/comparison-orchestrator';
import { notifyComparisonFinished } from './comparison-notifications';

/**
 * The comparison orchestrator of this process, with the real engine and the real notifications.
 * The web process starts and cancels comparisons; both processes advance them when a run ends, and
 * one of them sweeps. It lives here because execution may not import the integrations it notifies.
 */
export const comparisonOrchestrator = createComparisonOrchestrator({
  engine: createCompareRuns(),
  notify: notifyComparisonFinished,
});
