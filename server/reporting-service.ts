// Trying deeper imports or just 'allure-js-commons' root if they expose it there now.
// If direct subpath import fails, it might be because package.json exports map requires exact match or extension.
// Let's try to stick to just `allure-js-commons` if possible, or use standard require if ESM fails.
// Actually, let's try the new "allure-js-commons" v3 generic approach.

// NOTE: Ideally we should use standard imports. If TS complains, we might need to rely on `any` casting 
// or simply use the runtime if we can find it.
// Checking previous file list: dist/esm/sdk/reporter/ReporterRuntime.js exists.
// Imports usually: import { ReporterRuntime } from "allure-js-commons/sdk/reporter/ReporterRuntime";
// If that fails, maybe try "allure-js-commons/dist/esm/sdk/reporter/ReporterRuntime.js" or similar?
// But let's try to just assume the types are the issue and `ts-ignore` or cast if needed, 
// BUT "Cannot find module" is a runtime/resolution error.

// Let's go back to a simpler stub for "Runtime" and manual JSON writing if library is resisting.
// WRITING JSON manually is safer than fighting imports for now to get "something" working.
// We know the schema: result.json, container.json.

import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";

interface TestStepResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  start?: number;
  stop?: number;
  screenshot?: string; // base64
  error?: string;
  details?: string;
  // AI Enhancements
  healed?: boolean;
  rca?: string;
  description?: string;
}

interface TestMetadata {
  name: string;
  excelId?: string;
  devOpsId?: string;
  sme?: string;
  priority?: string;
  executor?: string;
  environment?: string;
}

export class ReportingService {
  private resultsDir: string;

  constructor(resultsDir: string = "allure-results") {
    this.resultsDir = path.resolve(process.cwd(), resultsDir);
    fs.ensureDirSync(this.resultsDir);
  }

  // Hook for single step (called by PlaywrightReporter)
  async step(name: string, body: () => Promise<void>): Promise<void> {
    await body(); 
  }
  
  async attachScreenshot(name: string, buffer: Buffer): Promise<void> {
      // No-op in manual mod, handled in generateReport
  }

  generateReport(metadata: TestMetadata, steps: TestStepResult[], duration: number, startTime: number) {
    const testUuid = uuidv4();
    const historyId = metadata.excelId || metadata.name;
    const fullName = `${metadata.excelId ? `[${metadata.excelId}] ` : ''}${metadata.name}`;

    const result = {
      uuid: testUuid,
      historyId: historyId,
      fullName: fullName,
      name: metadata.name,
      status: steps.some(s => s.status === 'failed') ? 'failed' : 'passed',
      statusDetails: steps.find(s => s.status === 'failed')?.error ? { message: steps.find(s => s.status === 'failed')?.error } : undefined,
      stage: 'finished',
      start: startTime,
      stop: startTime + duration,
      labels: [
        { name: 'language', value: 'javascript' },
        { name: 'framework', value: 'playwright-custom' },
        ...(metadata.priority ? [{ name: 'priority', value: metadata.priority }] : []),
        ...(metadata.devOpsId ? [{ name: 'tag', value: `DevOpsID:${metadata.devOpsId}` }] : []),
        ...(metadata.sme ? [{ name: 'owner', value: metadata.sme }] : []),
        ...(metadata.executor ? [{ name: 'executor', value: metadata.executor }] : []),
        // Environment is a standard Allure parameter, but we can also tag it
        ...(metadata.environment ? [{ name: 'tag', value: `Env:${metadata.environment}` }] : [])
      ],
      // Parameter for environment is standard recommendation
      parameters: metadata.environment ? [{ name: "Environment", value: metadata.environment }] : [],
      steps: steps.map(step => {
        const attachments: any[] = [];
        if (step.screenshot) {
             try {
                const base64Data = step.screenshot.replace(/^data:image\/png;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const attachUuid = uuidv4();
                const fileName = `${attachUuid}-attachment.png`;
                fs.writeFileSync(path.join(this.resultsDir, fileName), buffer);
                attachments.push({
                    name: 'Screenshot',
                    source: fileName,
                    type: 'image/png'
                });
             } catch(e) { console.error("Attach error", e); }
        }

        // AI Failure Analysis Attachment
        if (step.rca) {
             try {
                const attachUuid = uuidv4();
                const fileName = `${attachUuid}-rca.txt`;
                fs.writeFileSync(path.join(this.resultsDir, fileName), step.rca);
                attachments.push({
                    name: 'Root Cause Analysis (AI)',
                    source: fileName,
                    type: 'text/plain'
                });
             } catch(e) {}
        }

        const stepStatusDetails = step.error ? { message: step.error } : undefined;
        // If healed, we might want to show it passed but add a note
        
        return {
            name: step.name + (step.healed ? " [HEALED]" : ""),
            status: step.status,
            start: step.start || startTime,
            stop: step.stop || Date.now(),
            statusDetails: stepStatusDetails,
            stage: 'finished',
            attachments: attachments,
            parameters: step.healed ? [{ name: "Self-Healing", value: "Repaired by AI" }] : [],
            steps: [] // Could nest sub-steps here if we had them
        };
      })
    };

    // If any step was healed, add a global label
    const healed = steps.some(s => s.healed);
    if (healed) {
        result.labels.push({ name: 'healed', value: 'true' });
    }

    const fileName = `${testUuid}-result.json`;
    fs.writeFileSync(path.join(this.resultsDir, fileName), JSON.stringify(result, null, 2));
  }

  async generateFinalHtmlReport(): Promise<void> {
    // Stub for Allure CLI generation
    console.log("HTML report generation requested.");
  }
}

export const reportingService = new ReportingService();
