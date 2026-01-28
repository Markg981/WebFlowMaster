import { users, tests, testRuns, userSettings, sessions, type User, type InsertUser, type Test, type InsertTest, type TestRun, type InsertTestRun, type UserSettings, type InsertUserSettings } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import session from "express-session";
// import connectPg from "connect-pg-simple";
// import { pool } from "./db"; // Removed as pool is not available with SQLite


export class DatabaseSessionStore extends session.Store {
  constructor() {
    super();
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    db.select().from(sessions).where(eq(sessions.sid, sid))
      .then((rows) => {
        if (rows.length === 0) return callback(null, null);
        callback(null, rows[0].sess as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
      const expire = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 86400000);
      db.insert(sessions).values({
        sid,
        sess: sess as any, // Drizzle expects generic JSON
        expire
      }).onConflictDoUpdate({
        target: sessions.sid,
        set: { sess: sess as any, expire }
      })
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    db.delete(sessions).where(eq(sessions.sid, sid))
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }
}

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

  getUserSettings(userId: number): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: number, settingsData: Partial<Omit<InsertUserSettings, 'userId'>>): Promise<UserSettings>;
  
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  public sessionStore: session.Store;

  constructor() {
    this.sessionStore = new DatabaseSessionStore();
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
    return result.changes > 0;
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

  async getUserSettings(userId: number): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return settings || undefined;
  }

  async upsertUserSettings(userId: number, settingsData: Partial<Omit<InsertUserSettings, 'userId'>>): Promise<UserSettings> {
    // Ensure that userId from the path is used, and settingsData does not accidentally override it for the row identity.
    // For the 'set' part of onConflictDoUpdate, we use settingsData which should not contain userId.
    const [result] = await db
      .insert(userSettings)
      .values({ userId, ...settingsData })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: settingsData, // Drizzle will ignore userId in `set` if it's part of the target
      })
      .returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
