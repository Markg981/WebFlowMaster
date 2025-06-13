import { users, tests, testRuns, type User, type InsertUser, type Test, type InsertTest, type TestRun, type InsertTestRun } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getTest(id: number): Promise<Test | undefined>;
  getTestsByUser(userId: number): Promise<Test[]>;
  createTest(test: InsertTest): Promise<Test>;
  updateTest(id: number, test: Partial<InsertTest>): Promise<Test | undefined>;
  deleteTest(id: number): Promise<boolean>;
  
  createTestRun(testRun: InsertTestRun): Promise<TestRun>;
  getTestRuns(testId: number): Promise<TestRun[]>;
  updateTestRun(id: number, testRun: Partial<InsertTestRun>): Promise<TestRun | undefined>;
  
  sessionStore: session.SessionStore;
}

export class DatabaseStorage implements IStorage {
  public sessionStore: session.SessionStore;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getTest(id: number): Promise<Test | undefined> {
    const [test] = await db.select().from(tests).where(eq(tests.id, id));
    return test || undefined;
  }

  async getTestsByUser(userId: number): Promise<Test[]> {
    return await db.select().from(tests).where(eq(tests.userId, userId)).orderBy(desc(tests.updatedAt));
  }

  async createTest(test: InsertTest): Promise<Test> {
    const [newTest] = await db
      .insert(tests)
      .values(test)
      .returning();
    return newTest;
  }

  async updateTest(id: number, test: Partial<InsertTest>): Promise<Test | undefined> {
    const [updatedTest] = await db
      .update(tests)
      .set({ ...test, updatedAt: new Date() })
      .where(eq(tests.id, id))
      .returning();
    return updatedTest || undefined;
  }

  async deleteTest(id: number): Promise<boolean> {
    const result = await db.delete(tests).where(eq(tests.id, id));
    return result.rowCount > 0;
  }

  async createTestRun(testRun: InsertTestRun): Promise<TestRun> {
    const [newTestRun] = await db
      .insert(testRuns)
      .values(testRun)
      .returning();
    return newTestRun;
  }

  async getTestRuns(testId: number): Promise<TestRun[]> {
    return await db.select().from(testRuns).where(eq(testRuns.testId, testId)).orderBy(desc(testRuns.startedAt));
  }

  async updateTestRun(id: number, testRun: Partial<InsertTestRun>): Promise<TestRun | undefined> {
    const [updatedTestRun] = await db
      .update(testRuns)
      .set(testRun)
      .where(eq(testRuns.id, id))
      .returning();
    return updatedTestRun || undefined;
  }
}

export const storage = new DatabaseStorage();
