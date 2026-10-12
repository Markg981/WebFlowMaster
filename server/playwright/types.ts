import type { AccessibilityFinding } from '@shared/accessibility';
import type { DownloadFinding } from '@shared/downloads';
import { type MatrixEvidence } from '@shared/matrix-evidence';
import type { Cleanup, Precondition } from '@shared/schema';
import type { LighthouseFinding, PerformanceFinding } from '@shared/web-performance';
import { type BrowserChoice } from '../browsers';
import { type EvidenceOptions } from '../run-evidence';
import { type StepRuntime } from '../run-policies';
import { type VisualContext } from '../visual-testing';

// Default settings if not found or incomplete
export const DEFAULT_HEADLESS = true;
export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_WAIT_TIME = 2000;

/** What a detection run found, so a caller can tell the user it was truncated. */
export interface DetectionSummary {
  totalFound: number;
  returned: number;
  truncated: boolean;
  pageSize: { width: number; height: number };
}

/**
 * A detection run: the elements, and the picture the highlighting is drawn on.
 *
 * The screenshot belongs here rather than coming from loadWebsite() because the two used to
 * be separate browser sessions with separate navigations. On any page that renders
 * differently twice — a carousel, a grid ordered by time, anything with an ad — the image
 * and the boxes described two different pages, and the highlight landed on the wrong
 * element. It is full-page so that an element below the fold is on the image at all.
 */
export interface DetectionResult {
  elements: DetectedElement[];
  screenshot: string;
  summary: DetectionSummary;
}

// Define interfaces for TestStep and StepResult based on the requirements
export interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

export interface DetectedElement {
  // Exporting if it's used elsewhere, or keep private
  id: string;
  type: string;
  selector: string;
  /**
   * The iframe chain this element's selector is relative to, ' >> ' separated, or absent
   * for the top document.
   *
   * page.locator() does not cross an iframe boundary, so an element inside one needs both
   * halves to be reachable: which frame, and where in it. Without this the element was not
   * merely unclickable — detection never saw it, which reads as the page not having it.
   */
  frameSelector?: string | null;
  text?: string | null;
  tag: string;
  attributes: Record<string, string>;
  boundingBox?: {
    // Optional as per original description
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TestStep {
  id: string;
  action: TestAction;
  targetElement?: DetectedElement;
  value?: string | null;
}

export interface StepResult {
  matrixEvidence?: MatrixEvidence;
  name: string;
  type: string;
  /** The test's own id for the step, when it has one. */
  stepId?: string;
  /** The step-group call the step came from: its id is the group's, not the test's. */
  calledFrom?: string;
  selector?: string | null;
  value?: string | null;
  status: 'passed' | 'failed';
  screenshot?: string;
  error?: string;
  details: string;
  healed?: boolean;
  rca?: string;
  /**
   * What the visual comparison made of this step, when the plan asked for one.
   *
   * Kept beside the verdict rather than folded into `details`, so a report can show the
   * baseline, the actual and the diff as three pictures instead of a sentence about them.
   */
  visual?: {
    outcome: 'baseline-created' | 'baseline-updated' | 'match' | 'diff' | 'skipped';
    detail: string;
    diffRatio?: number;
    baselineImage?: string;
    actualImage?: string;
    diffImage?: string;
  };
  /** What an accessibility check found on the page, every violation with whether it failed the step. */
  accessibility?: AccessibilityFinding;
  /** What a measurePerformance step measured (shared/web-performance.ts). */
  performance?: PerformanceFinding;
  /** What an auditLighthouse step scored. */
  lighthouse?: LighthouseFinding;
  /** The file an expectDownload step checked (shared/downloads.ts). */
  download?: DownloadFinding;
}

/**
 * What a test plan adds to a run that the test itself does not carry.
 *
 * Both of these are configuration the product collected and then ignored: the browser was
 * read off the run owner's profile whatever the plan said, and the visual testing switch
 * turned nothing on.
 */
export interface ExecuteSequenceOptions {
  browser?: BrowserChoice;
  visual?: VisualContext;
  /** Whether to keep a video and a trace of this run, and where to put them. */
  evidence?: EvidenceOptions;
  /**
   * The plan's timeouts, screenshot policy and step retry — see server/run-policies.ts. Absent
   * for a run no plan drives, which keeps the user's own timeout and a screenshot of every step.
   */
  runtime?: StepRuntime;
  /** Aborted when the run is cancelled or out of time: no further step starts. */
  signal?: AbortSignal;
  /**
   * The language the browser starts in: navigator.language, the Accept-Language header, and
   * the formats Intl uses (shared/locales.ts). Absent: the browser's own default.
   */
  locale?: string;
  /**
   * Told the variables of each run of the steps (one per dataset row), as the steps leave them:
   * what they stored is there too. The cleanup after the test reads them (server/cleanup-runner.ts).
   */
  onVariables?: (vars: Record<string, string>) => void;
}

// Interface for the ad-hoc sequence payload
export interface AdhocSequencePayload {
  url: string;
  sequence: TestStep[];
  elements: DetectedElement[]; // Currently for context, not actively used in loop logic by default
  name?: string;
  /** Same setup calls the scheduled runner performs, so the preview matches the real run. */
  preconditions?: Precondition[] | null;
  /** Same cleanup calls the scheduled runner makes after the test (server/cleanup-runner.ts). */
  cleanups?: Cleanup[] | null;
  /** Environment whose secrets resolve `{{name}}` placeholders, as picked in the builder. */
  environmentId?: number | null;
  /** Organization the environment must belong to — set by the route, never by the client. */
  organizationId?: number;
  /** Rows to run over, so the preview runs as many times as the saved test will. */
  dataset?: Array<Record<string, string>> | null;
  /** One row's values, set by the loop above when it calls back in for a single pass. */
  rowVariables?: Record<string, string> | null;
}
