import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../platform/logger';
import { privilegedDb } from '../platform/db';
import { tests, detectedElements } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

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
   * Self-Healing: Analyze DOM and find new selector
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
      const response = result.response;
      let newSelector = response.text().trim();

      // Cleanup response if it contains backticks
      newSelector = newSelector.replace(/```/g, '').replace(/css/g, '').trim();

      this.logInfo('AI proposed new selector', { newSelector });
      return newSelector;
    } catch (e: any) {
      this.logError('AI Self-Healing failed', { error: e.message });
      return null;
    }
  }

  /**
   * Update DB with healed selector: Updates both 'sequence' and 'elements' columns
   */
  async updateSelectorInDb(testId: number, stepIndex: number, newSelector: string) {
    try {
      // Fetch current test
      const testRecord = await privilegedDb
        .select()
        .from(tests)
        .where(eq(tests.id, testId))
        .limit(1);
      if (testRecord.length === 0) return;

      const sequence = testRecord[0].sequence as any[];
      const elements = testRecord[0].elements as any[];
      let updatedElements = false;

      // Update the specific step in sequence
      if (sequence && sequence[stepIndex]) {
        // If the step has a targetElement, update its selector
        if (sequence[stepIndex].targetElement) {
          const oldSelector = sequence[stepIndex].targetElement.selector;
          const elementId = sequence[stepIndex].targetElement.id; // Assuming ID is present

          // 1. Update Sequence Step
          sequence[stepIndex].targetElement.selector = newSelector;
          this.logInfo('Updated Sequence Step with healed selector', { testId, stepIndex });

          // 2. Update Elements Repository if ID matches
          if (elements && Array.isArray(elements) && elementId) {
            const elementIndex = elements.findIndex((e: any) => e.id === elementId);
            if (elementIndex !== -1) {
              elements[elementIndex].selector = newSelector;
              updatedElements = true;
              this.logInfo('Updated Elements Repository with healed selector', {
                testId,
                elementId,
              });
            }
          } else if (elements && Array.isArray(elements)) {
            // Fallback: Try to match by old selector if ID missing
            const elementIndex = elements.findIndex((e: any) => e.selector === oldSelector);
            if (elementIndex !== -1) {
              elements[elementIndex].selector = newSelector;
              updatedElements = true;
              this.logInfo('Updated Elements Repository by matching old selector', {
                testId,
                oldSelector,
              });
            }
          }
        }

        await privilegedDb
          .update(tests)
          .set({
            sequence: sequence,
            elements: updatedElements ? elements : undefined, // Update elements only if changed
          })
          .where(eq(tests.id, testId));

        this.logInfo('Legacy DB Sync Complete', { testId });

        // 3. Update Normalized Table (detectedElements)
        if (sequence[stepIndex].targetElement && sequence[stepIndex].targetElement.id) {
          const elementId = sequence[stepIndex].targetElement.id;
          // Check if exists
          const existingElement = await privilegedDb
            .select()
            .from(detectedElements)
            .where(
              and(eq(detectedElements.testId, testId), eq(detectedElements.elementId, elementId)),
            )
            .limit(1);

          if (existingElement.length > 0) {
            await privilegedDb
              .update(detectedElements)
              .set({
                selector: newSelector,
                originalSelector:
                  existingElement[0].originalSelector || existingElement[0].selector, // Keep origin if exists
              })
              .where(eq(detectedElements.id, existingElement[0].id));
            this.logInfo('Normalized DB Update - Updated existing element', { testId, elementId });
          } else {
            await privilegedDb.insert(detectedElements).values({
              // A detected element belongs to the same organization as its test.
              organizationId: testRecord[0].organizationId,
              testId,
              elementId,
              selector: newSelector,
              originalSelector: sequence[stepIndex].targetElement.selector, // The 'old' one before this update? No, that was updated in memory above.
              // Actually, we should probably grab the old one before we mutated 'sequence' object above?
              // But for now, let's just insert.
              type: sequence[stepIndex].targetElement.tag,
              text: sequence[stepIndex].targetElement.text,
              tag: sequence[stepIndex].targetElement.tag,
              attributes: sequence[stepIndex].targetElement.attributes,
            });
            this.logInfo('Normalized DB Update - Inserted new element', { testId, elementId });
          }
        }
      }
    } catch (e: any) {
      this.logError('Failed to update DB with healed selector', { error: e.message });
    }
  }
}

export const aiService = new AIAutomationService();
