import { Router } from "express";
import multer from "multer";
import { excelService } from "../excel-service";
import fs from "fs-extra";
import loggerPromise from "../logger";
import { excelSequencesMap, tests } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";

/**
 * `testId` reaches a query, so it has to be a number before it gets there — an unvalidated
 * value surfaced as a 500 rather than a 400.
 */
const excelMappingSchema = z.object({
  excelTestCaseId: z.string().min(1),
  testId: z.coerce.number().int().positive(),
});

const router = Router();
const logger = await loggerPromise;
const upload = multer({ dest: 'uploads/' });

// POST /api/upload-excel - Parse Excel file
router.post("/api/upload-excel", upload.single('file'), async (req, res) => {
    // Note: Auth check removed for demo ease, but should be added:
    // if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const detectedColumns = await excelService.detectColumns(req.file.path);
      const mappings = excelService.getDefaultMappings(detectedColumns);
      
      // Basic validation looking for 'Test Case ID' or similar
      const testIdCol = mappings.testCaseId;
      if (!testIdCol) {
          // If auto-map fails, we might still parse but maybe warn? 
          // For now proceeded with best effort parsing using default assumption if logic permits
      }

      const parsedData = await excelService.parseExcel(req.file.path, mappings);
      
      // Cleanup uploaded file
      await fs.unlink(req.file.path).catch(err => logger.warn("Failed to delete uploaded file", err));

      res.json(parsedData);

    } catch (error: any) {
      logger.error({ message: "Error parsing Excel", error: error.message });
      res.status(500).json({ error: "Failed to parse Excel file" });
    }
});

// POST /api/excel-mappings - Save sequence mappings
router.post("/api/excel-mappings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    
    const parseResult = excelMappingSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });
    }
    const { excelTestCaseId, testId } = parseResult.data;

    try {
        // testId names a row in another tenant-scoped table. Take organizationId from that
        // parent row (never from the session, and never from the body) so a caller cannot
        // bind a foreign org's test into a mapping stamped with their own organizationId.
        const [test] = await db.select({ organizationId: tests.organizationId }).from(tests).where(eq(tests.id, testId)).limit(1);
        // One 404 for both "no such test" and "not yours". Distinguishing them would answer
        // "does test N exist?" for every id in the table, across tenants.
        if (!test || test.organizationId !== (req.user as { organizationId: number }).organizationId) {
            return res.status(404).json({ error: "Test not found" });
        }

        await db.insert(excelSequencesMap).values({
            organizationId: test.organizationId,
            excelTestCaseId,
            testId
        }).onConflictDoNothing(); // Simple upsert logic

        res.json({ success: true });
    } catch(e: any) {
        logger.error({ message: "Error saving mapping", error: e.message });
        res.status(500).json({ error: "Failed to save mapping" });
    }
});

// GET /api/excel-mappings - List mappings
router.get("/api/excel-mappings", async (req, res) => {
   if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
   try {
       const mappings = await db.select().from(excelSequencesMap);
       res.json(mappings);
   } catch(e: any) {
       res.status(500).json({ error: "Error fetching mappings" });
   }
});

export default router;
