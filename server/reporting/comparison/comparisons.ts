import { createCompareRuns } from './compare-runs';
import { createComparisonOrchestrator } from '../../execution/comparison-orchestrator';

/**
 * The comparison orchestrator of this process, with the real engine. The web process starts and
 * cancels comparisons; both processes advance them when a run ends, and one of them sweeps.
 */
export const comparisonOrchestrator = createComparisonOrchestrator({ engine: createCompareRuns() });
