import { Router } from "express";
import { getDashboardMetrics } from "../analytics";
import loggerPromise from "../logger";

const router = Router();
const logger = await loggerPromise;

/**
 * GET /api/analytics/dashboard — the figures the dashboard is built from.
 *
 * `getDashboardMetrics` existed and was never called: nothing mounted a route for it, so the
 * client's request fell through to the catch-all that serves index.html, `res.json()` threw
 * on the HTML, and the query failed. The dashboard then showed zeroes and empty panels for
 * every account — not because nothing had run, but because the page was not connected to
 * anything. An empty state is only honest when a full one is reachable.
 */
router.get("/api/analytics/dashboard", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const metrics = await getDashboardMetrics((req.user as { id: number }).id);
    res.json(metrics);
  } catch (e: any) {
    logger.error({ message: "Dashboard metrics failed", error: e.message });
    res.status(500).json({ error: "Failed to load dashboard metrics" });
  }
});

export default router;
