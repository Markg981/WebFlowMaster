import express, { Router } from "express";
import { AUDIT_ACTIONS } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { issueSmsToken, readInbound, receiveSms, recentSms, revokeSmsToken, smsInboxStatus } from "../sms-inbox";
import { publicBase } from "./sso.routes";

/**
 * The test SMS inbox (server/sms-inbox.ts): the inbound address a provider posts to, and its
 * settings. Owners issue and revoke the address; editors read what arrived, to see a number is
 * wired up.
 */

export const SMS_INBOUND_PATH = "/api/sms/inbound";

/** Public: the provider has no session, only the token in the address. */
export const smsInboundRouter = Router();
smsInboundRouter.use(express.urlencoded({ extended: false, limit: "64kb" }));
smsInboundRouter.post("/:token", async (req, res) => {
  const sms = readInbound((req.body ?? {}) as Record<string, unknown>);
  if (!sms) return res.status(400).json({ error: "Expected the recipient number and the text (To and Body, or to and text)." });
  if (!(await receiveSms(String(req.params.token), sms))) return res.status(404).json({ error: "Unknown inbox." });
  // Twilio replies to the sender with whatever TwiML says: an empty response sends nothing.
  if (sms.provider === "twilio") return res.type("text/xml").send("<Response/>");
  res.status(204).end();
});

const router = Router();

router.get("/api/organization/sms-inbox", requireRole("editor"), async (req, res) => {
  const status = await smsInboxStatus(getTenantOrgId()!);
  res.json({ ...status, inboundUrl: status.prefix ? `${publicBase(req)}${SMS_INBOUND_PATH}/${status.prefix}…` : null, messages: await recentSms() });
});

router.post("/api/organization/sms-inbox/token", requireRole("owner"), async (req, res) => {
  const issued = await issueSmsToken(getTenantOrgId()!);
  await withTenantTransaction((tx) =>
    recordAudit(tx, { action: AUDIT_ACTIONS.SMS_INBOX_TOKEN_ISSUED, actor: auditActor(req), targetType: "organization", targetId: String(getTenantOrgId()), metadata: { prefix: issued.status.prefix } }),
  );
  res.status(201).json({ ...issued.status, inboundUrl: `${publicBase(req)}${SMS_INBOUND_PATH}/${issued.token}` });
});

router.delete("/api/organization/sms-inbox/token", requireRole("owner"), async (req, res) => {
  await revokeSmsToken(getTenantOrgId()!);
  await withTenantTransaction((tx) =>
    recordAudit(tx, { action: AUDIT_ACTIONS.SMS_INBOX_TOKEN_REVOKED, actor: auditActor(req), targetType: "organization", targetId: String(getTenantOrgId()) }),
  );
  res.status(204).end();
});

export default router;
