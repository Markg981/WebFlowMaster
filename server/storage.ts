import { organizations, users, invitations, auditLog, AUDIT_ACTIONS, tests, testRuns, userSettings, sessions, type User, type InsertUser, type Test, type InsertTest, type TestRun, type InsertTestRun, type UserSettings, type InsertUserSettings } from "@shared/schema";
import { privilegedDb } from "./db";
import { eq, desc } from "drizzle-orm";
import session from "express-session";
// import connectPg from "connect-pg-simple";
// import { pool } from "./db"; // Removed as pool is not available with SQLite


export class DatabaseSessionStore extends session.Store {
  constructor() {
    super();
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    privilegedDb.select().from(sessions).where(eq(sessions.sid, sid))
      .then((rows) => {
        if (rows.length === 0) return callback(null, null);
        callback(null, rows[0].sess as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    const expire = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 86400000);
    privilegedDb.insert(sessions).values({
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
    privilegedDb.delete(sessions).where(eq(sessions.sid, sid))
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createUserFromInvitation(
    user: InsertUser,
    token: string,
  ): Promise<User | { error: 'invalid' | 'expired' | 'used' }>;

  getTest(id: number): Promise<Test | undefined>;
  getTestsByUser(userId: number): Promise<Test[]>;
  createTest(test: InsertTest, organizationId: number): Promise<Test>;
  updateTest(id: number, test: Partial<InsertTest>): Promise<Test | undefined>;
  deleteTest(id: number): Promise<boolean>;

  createTestRun(testRun: InsertTestRun): Promise<TestRun>;
  getTestRuns(testId: number): Promise<TestRun[]>;
  updateTestRun(id: number, testRun: Partial<InsertTestRun>): Promise<TestRun | undefined>;

  getUserSettings(userId: number): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: number, settingsData: Partial<Omit<InsertUserSettings, 'userId'>>): Promise<UserSettings>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await privilegedDb.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await privilegedDb.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // A user cannot exist without an organization, so registration creates one and makes
    // the registrant its owner. Both rows are written in one transaction: a user pointing
    // at an organization that failed to insert would be unusable, and an organization with
    // no members is unreachable.
    return privilegedDb.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name: `${insertUser.username}'s organization` })
        .returning();

      const [user] = await tx
        .insert(users)
        .values({ ...insertUser, organizationId: organization.id, role: 'owner' })
        .returning();

      return user;
    });
  }

  /**
   * Registration by invitation: the new account joins the inviting organization instead of
   * getting one of its own, with the role the invitation named.
   *
   * Privileged, and necessarily so — this runs before the user exists, so there is no session
   * and no tenant context to bind. That is the same reason `invitations` carries no RLS policy.
   *
   * The token check, the expiry check, the username check and the two writes are all inside
   * one transaction: a token validated and then used a moment later is a token two concurrent
   * registrations could both pass. Marking it accepted in the same transaction as the insert
   * is what makes it single-use.
   */
  async createUserFromInvitation(
    insertUser: InsertUser,
    token: string,
  ): Promise<User | { error: 'invalid' | 'expired' | 'used' }> {
    return privilegedDb.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.token, token))
        .limit(1);

      if (!invitation) return { error: 'invalid' as const };
      if (invitation.acceptedAt) return { error: 'used' as const };
      if (invitation.expiresAt.getTime() <= Date.now()) return { error: 'expired' as const };
      // The invitation names a username; registering under a different one with someone else's
      // token would let a stranger consume an invitation meant for a colleague.
      if (invitation.username !== insertUser.username) return { error: 'invalid' as const };

      const [user] = await tx
        .insert(users)
        .values({
          ...insertUser,
          organizationId: invitation.organizationId,
          role: invitation.role,
        })
        .returning();

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));

      // Written here rather than through recordAudit: that helper takes the organization from
      // the ambient tenant context, and there is none — this runs before the account exists,
      // so there is no session to establish one. The organization comes from the invitation
      // row instead, which is the only trustworthy source at this point. Same transaction as
      // the account creation, which is the property that matters.
      await tx.insert(auditLog).values({
        organizationId: invitation.organizationId,
        actorUserId: user.id,
        actorUsername: user.username,
        action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
        targetType: 'invitation',
        targetId: String(invitation.id),
        metadata: { role: invitation.role, invitedByUserId: invitation.invitedByUserId },
      });

      return user;
    });
  }

  async getTest(id: number): Promise<Test | undefined> {
    const [test] = await privilegedDb.select().from(tests).where(eq(tests.id, id));
    return test || undefined;
  }

  async getTestsByUser(userId: number): Promise<Test[]> {
    return await privilegedDb.select().from(tests).where(eq(tests.userId, userId)).orderBy(desc(tests.updatedAt));
  }

  async createTest(test: InsertTest, organizationId: number): Promise<Test> {
    // organizationId is the tenancy boundary: it comes from the caller's session, never
    // from the InsertTest payload (insertTestSchema omits it for the same reason userId is).
    const [newTest] = await privilegedDb
      .insert(tests)
      .values({ ...test, organizationId })
      .returning();
    return newTest;
  }

  async updateTest(id: number, test: Partial<InsertTest>): Promise<Test | undefined> {
    const [updatedTest] = await privilegedDb
      .update(tests)
      .set({ ...test, updatedAt: new Date() })
      .where(eq(tests.id, id))
      .returning();
    return updatedTest || undefined;
  }

  async deleteTest(id: number): Promise<boolean> {
    const deleted = await privilegedDb.delete(tests).where(eq(tests.id, id)).returning();
    return deleted.length > 0;
  }

  async createTestRun(testRun: InsertTestRun): Promise<TestRun> {
    const [newTestRun] = await privilegedDb
      .insert(testRuns)
      .values(testRun)
      .returning();
    return newTestRun;
  }

  async getTestRuns(testId: number): Promise<TestRun[]> {
    return await privilegedDb.select().from(testRuns).where(eq(testRuns.testId, testId)).orderBy(desc(testRuns.startedAt));
  }

  async updateTestRun(id: number, testRun: Partial<InsertTestRun>): Promise<TestRun | undefined> {
    const [updatedTestRun] = await privilegedDb
      .update(testRuns)
      .set(testRun)
      .where(eq(testRuns.id, id))
      .returning();
    return updatedTestRun || undefined;
  }

  async getUserSettings(userId: number): Promise<UserSettings | undefined> {
    const [settings] = await privilegedDb.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return settings || undefined;
  }

  async upsertUserSettings(userId: number, settingsData: Partial<Omit<InsertUserSettings, 'userId'>>): Promise<UserSettings> {
    // Ensure that userId from the path is used, and settingsData does not accidentally override it for the row identity.
    // For the 'set' part of onConflictDoUpdate, we use settingsData which should not contain userId.
    const [result] = await privilegedDb
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
