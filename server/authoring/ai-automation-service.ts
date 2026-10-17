import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../platform/logger';
import { parseLocatorAnswer } from './healing-proposals';

/**
 * The Gemini model every AI feature asks: authoring, failure analysis and selector healing.
 * GEMINI_MODEL overrides the default. One resolution, so the three never drift again — healing
 * was pinned to "gemini-pro", which Google has retired, while the others followed this variable.
 */
export function geminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL || 'gemini-2.0-flash';
}

export class AIAutomationService {
  /** The client, or nothing: without a key there is no Google to call, and nothing here tries. */
  private genAI: GoogleGenerativeAI | null;
  /** GEMINI_BASE_URL: another endpoint for the same API, such as a test double in the collaudo stack. */
  private readonly requestOptions = process.env.GEMINI_BASE_URL
    ? { baseUrl: process.env.GEMINI_BASE_URL }
    : undefined;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Said once, here, rather than on every call that then quietly does nothing.
      this.logWarn('GEMINI_API_KEY not set. AI features disabled.');
      this.genAI = null;
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  private async logInfo(message: string, meta?: any) {
    logger.info(message, meta);
  }

  private async logWarn(message: string, meta?: any) {
    logger.warn(message, meta);
  }

  private async logError(message: string, meta?: any) {
    logger.error(message, meta);
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /** A model handle, or nothing when the service is disabled. */
  private model() {
    return (
      this.genAI?.getGenerativeModel({ model: this.analysisModel }, this.requestOptions) ?? null
    );
  }

  /**
   * Answers the authoring prompt, or nothing.
   *
   * Deliberately thin: everything that decides what may be asked and what may be believed
   * lives in server/authoring/nl-authoring.ts, where it can be tested without a network. This only
   * carries the text there and back, and returns null for every failure — a model that is
   * unavailable degrades the feature to the phrasings the parser already understands.
   */
  async proposeTestSteps(prompt: string): Promise<string | null> {
    const model = this.model();
    if (!model) return null;

    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e: any) {
      this.logError('AI step authoring failed', { error: e.message });
      return null;
    }
  }

  /**
   * Answers a story's test proposal prompt (server/authoring/story-tests.ts), or nothing. As thin as
   * proposeTestSteps, and for the same reason.
   */
  async proposeTestCases(prompt: string): Promise<string | null> {
    const model = this.model();
    if (!model) return null;

    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e: any) {
      this.logError('AI test proposal failed', { error: e.message });
      return null;
    }
  }

  /** The model a failure analysis is asked of, as the analysis records it. */
  get analysisModel(): string {
    return geminiModel();
  }

  /**
   * Answers a failure analysis prompt (server/reporting/failure-analysis.ts), with the page's screenshot
   * when there is one, or nothing. As thin as proposeTestSteps, and for the same reason.
   */
  async explainFailure(
    prompt: string,
    screenshot?: { bytes: Buffer; contentType: string } | null,
  ): Promise<string | null> {
    const model = this.model();
    if (!model) return null;

    try {
      const parts: any[] = [{ text: prompt }];
      if (screenshot)
        parts.push({
          inlineData: {
            mimeType: screenshot.contentType,
            data: screenshot.bytes.toString('base64'),
          },
        });
      const result = await model.generateContent(parts);
      return result.response.text();
    } catch (e: any) {
      this.logError('AI failure analysis failed', { error: e.message });
      return null;
    }
  }

  /**
   * Self-healing: proposes a selector for the element a failed one meant, from the page's DOM.
   *
   * A suggestion only, asked for after the test's own known fallbacks found nothing, and with
   * `pageSource` already stripped of form values and tokens (domForModel). Which step it belongs
   * to is never the model's to say, and whether it is used is not either: the runner uses it only
   * if it matches exactly one element, and it reaches the test only as a proposal a person
   * approves (server/authoring/healing-proposals.ts).
   */
  async healSelector(
    originalSelector: string,
    pageSource: string,
    error: string,
  ): Promise<string | null> {
    const model = this.model();
    if (!model) return null;

    try {
      this.logInfo('Attempting AI Self-Healing', { originalSelector });

      // Truncate pageSource if too large to avoid token limits
      const truncatedSource = pageSource.substring(0, 30000);

      const prompt = `
        You are a Test Automation Expert. A Playwright test failed because the selector "${originalSelector}" was not found.
        
        Error: ${error}

        Analyze the following HTML (truncated) and identify the element that most likely corresponds to the original intent.
        Prioritize these attributes for stability: ng-model, data-testid, id, name, aria-label, stable class names.
        
        HTML Context:
        ${truncatedSource}

        Return ONLY the new CSS or XPath selector string. Do not add markdown blocks or explanations.
      `;

      const result = await model.generateContent(prompt);
      // One locator or nothing: a fence around the answer goes, nothing inside the locator does
      // ("css-grid > a" and "css=.btn" stay whole), and several lines are not one locator.
      const newSelector = parseLocatorAnswer(result.response.text());

      this.logInfo('AI proposed new selector', { newSelector });
      return newSelector;
    } catch (e: any) {
      this.logError('AI Self-Healing failed', { error: e.message });
      return null;
    }
  }
}

export const aiService = new AIAutomationService();
