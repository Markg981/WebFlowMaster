import { Router } from "express";
import { db } from "../db";
import { projects, insertProjectSchema } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";

const router = Router();
const logger = await loggerPromise;

// GET /api/projects - List all projects
router.get("/api/projects", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));
    res.json(allProjects);
  } catch (error: any) {
    logger.error({ message: "Error fetching projects", error: error.message, stack: error.stack });
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/projects - Create a new project
router.post("/api/projects", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parseResult = insertProjectSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid project data", details: parseResult.error.flatten() });
  }

  try {
    const newProject = await db.insert(projects).values({ ...parseResult.data, userId: (req.user as any).id }).returning();
    res.status(201).json(newProject[0]);
  } catch (error: any) {
    logger.error({ message: "Error creating project", error: error.message });
    res.status(500).json({ error: "Failed to create project" });
  }
});

export default router;
