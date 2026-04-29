import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import loggerPromise from "./logger";
import { db } from "./db";
import { tests, detectedElements } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export class AIAutomationService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      this.logWarn("GEMINI_API_KEY not set. AI features disabled.");
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey || "dummy_key");
    this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
  }

  private async logInfo(message: string, meta?: any) {
    const logger = await loggerPromise;
    logger.info(message, meta);
  }

  private async logWarn(message: string, meta?: any) {
      const logger = await loggerPromise;
      logger.warn(message, meta);
  }

  private async logError(message: string, meta?: any) {
      const logger = await loggerPromise;
      logger.error(message, meta);
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }




  /**
   * Self-Healing: Analyze DOM and find new selector
   */
  async healSelector(originalSelector: string, pageSource: string, error: string): Promise<string | null> {
    if (!this.isAvailable()) return null;

    try {
      this.logInfo("Attempting AI Self-Healing", { originalSelector });

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

      const result = await this.model.generateContent(prompt);
      const response = result.response;
      let newSelector = response.text().trim();

      // Cleanup response if it contains backticks
      newSelector = newSelector.replace(/```/g, "").replace(/css/g, "").trim();

      this.logInfo("AI proposed new selector", { newSelector });
      return newSelector;

    } catch (e: any) {
      this.logError("AI Self-Healing failed", { error: e.message });
      return null;
    }
  }

  /**
   * Update DB with healed selector: Updates both 'sequence' and 'elements' columns
   */
  async updateSelectorInDb(testId: number, stepIndex: number, newSelector: string) {
    try {
      // Fetch current test
      const testRecord = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
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
            this.logInfo("Updated Sequence Step with healed selector", { testId, stepIndex });

            // 2. Update Elements Repository if ID matches
            if (elements && Array.isArray(elements) && elementId) {
                const elementIndex = elements.findIndex((e: any) => e.id === elementId);
                if (elementIndex !== -1) {
                    elements[elementIndex].selector = newSelector;
                    updatedElements = true;
                    this.logInfo("Updated Elements Repository with healed selector", { testId, elementId });
                }
            } else if (elements && Array.isArray(elements)) {
                 // Fallback: Try to match by old selector if ID missing
                 const elementIndex = elements.findIndex((e: any) => e.selector === oldSelector);
                 if (elementIndex !== -1) {
                    elements[elementIndex].selector = newSelector;
                    updatedElements = true;
                     this.logInfo("Updated Elements Repository by matching old selector", { testId, oldSelector });
                 }
            }
        } 
        
        await db.update(tests)
          .set({ 
              sequence: sequence,
              elements: updatedElements ? elements : undefined // Update elements only if changed
          })
          .where(eq(tests.id, testId));
          
        this.logInfo("Legacy DB Sync Complete", { testId });
        
        // 3. Update Normalized Table (detectedElements)
        if (sequence[stepIndex].targetElement && sequence[stepIndex].targetElement.id) {
            const elementId = sequence[stepIndex].targetElement.id;
             // Check if exists
             const existingElement = await db.select().from(detectedElements).where(and(eq(detectedElements.testId, testId), eq(detectedElements.elementId, elementId))).limit(1);
             
             if (existingElement.length > 0) {
                 await db.update(detectedElements)
                    .set({ 
                        selector: newSelector,
                        originalSelector: existingElement[0].originalSelector || existingElement[0].selector // Keep origin if exists
                    })
                    .where(eq(detectedElements.id, existingElement[0].id));
                 this.logInfo("Normalized DB Update - Updated existing element", { testId, elementId });
             } else {
                 await db.insert(detectedElements).values({
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
                 this.logInfo("Normalized DB Update - Inserted new element", { testId, elementId });
             }
        }
      }

    } catch (e: any) {
      this.logError("Failed to update DB with healed selector", { error: e.message });
    }
  }

  /**
   * Root Cause Analysis
   */
  async analyzeFailure(error: string, stack: string, networkLogs: string[], screenshotBase64?: string): Promise<string> {
    if (!this.isAvailable()) return "AI Analysis Unavailable (No Key)";

    try {
      this.logInfo("Starting AI Failure Analysis");

      const prompt = `
        Analyze the following Test Failure.
        
        Error Message: ${error}
        Stack Trace: ${stack}
        Last 5 Network Logs:
        ${networkLogs.join("\n")}

        Provide a Root Cause Analysis in natural language (Italian).
        Explain WHY the test reportedly failed. Distinguish between UI issues (selector not found) and Backend issues (500 errors, timeouts).
        If network logs show an error, highlight it.

        Format as a short paragraph.
      `;

      const result = await this.model.generateContent(prompt);
      return result.response.text();

    } catch (e: any) {
      this.logError("AI Failure Analysis failed", { error: e.message });
      return "AI Analysis Failed";
    }
  }
}


export const aiService = new AIAutomationService();
