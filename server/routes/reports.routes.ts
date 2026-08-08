import { Router } from "express";
import { reportingService } from "../reporting-service";
import loggerPromise from "../logger";
import { requireRole } from "../middleware/require-role";

const router = Router();
const logger = await loggerPromise;

// POST /api/reports/generate - Generate Allure Report
router.post("/api/reports/generate", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    
    try {
        await reportingService.generateFinalHtmlReport();
        res.json({ success: true, message: "Report generated successfully" });
    } catch (e: any) {
        logger.error({ message: "Report handling failed", error: e.message });
        res.status(500).json({ error: "Failed to generate report" });
    }
});

export default router;
