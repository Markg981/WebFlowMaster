import { AdhocRunner } from './playwright/adhoc-runner';
import { ElementDetectionService } from './playwright/element-detection-service';
import { RecordingService } from './playwright/recording-service';
import { TestRunner } from './playwright/test-runner';

/**
 * The browser side of the product, behind the API the routes and the runner have always used.
 *
 * This used to be one class doing four jobs. Each job is now its own service under
 * server/web/playwright/, and every browser any of them opens comes from server/web/browser-session.ts:
 *   - RecordingService: the headed recorder window, its buffered actions and the idle sweeper
 *   - ElementDetectionService: loading a page, listing its elements, counting selector matches
 *   - AdhocRunner: the builder's "Execute Test" preview
 *   - TestRunner: a saved test, run for a plan, a schedule or a person
 */
export class PlaywrightService {
  readonly recording = new RecordingService();
  readonly detection = new ElementDetectionService();
  readonly adhoc = new AdhocRunner(this.detection);
  readonly tests = new TestRunner();

  getLastDetectionSummary() {
    return this.detection.getLastDetectionSummary();
  }

  loadWebsite(...args: Parameters<ElementDetectionService['loadWebsite']>) {
    return this.detection.loadWebsite(...args);
  }

  detectElements(...args: Parameters<ElementDetectionService['detectElements']>) {
    return this.detection.detectElements(...args);
  }

  countSelectorMatches(...args: Parameters<ElementDetectionService['countSelectorMatches']>) {
    return this.detection.countSelectorMatches(...args);
  }

  startRecordingSession(...args: Parameters<RecordingService['startRecordingSession']>) {
    return this.recording.startRecordingSession(...args);
  }

  stopRecordingSession(...args: Parameters<RecordingService['stopRecordingSession']>) {
    return this.recording.stopRecordingSession(...args);
  }

  getRecordedActions(...args: Parameters<RecordingService['getRecordedActions']>) {
    return this.recording.getRecordedActions(...args);
  }

  captureLoginState(...args: Parameters<RecordingService['captureLoginState']>) {
    return this.recording.captureLoginState(...args);
  }

  withRecordingContext(...args: Parameters<RecordingService['withRecordingContext']>) {
    return this.recording.withRecordingContext(...args);
  }

  installRecorder(...args: Parameters<RecordingService['installRecorder']>) {
    return this.recording.installRecorder(...args);
  }

  registerSession(...args: Parameters<RecordingService['registerSession']>) {
    return this.recording.registerSession(...args);
  }

  disposeAllRecordingSessions() {
    return this.recording.disposeAllRecordingSessions();
  }

  executeAdhocSequence(...args: Parameters<AdhocRunner['executeAdhocSequence']>) {
    return this.adhoc.executeAdhocSequence(...args);
  }

  executeTestSequence(...args: Parameters<TestRunner['executeTestSequence']>) {
    return this.tests.executeTestSequence(...args);
  }
}

export const playwrightService = new PlaywrightService();

export type {
  AdhocSequencePayload,
  DetectedElement,
  DetectionResult,
  DetectionSummary,
  ExecuteSequenceOptions,
  StepResult,
} from './playwright/types';
export { evidenceScreenshot, scopeFor } from './playwright/run-helpers';
