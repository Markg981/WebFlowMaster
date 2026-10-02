import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { sharedStore } from "../middleware/rate-limit-store";
import loggerPromise from "../logger";
import { publicBase } from "./sso.routes";
import {
  SCHEMAS,
  SCIM_BASE_PATH,
  ScimError,
  createGroup,
  createUser,
  deleteGroup,
  deleteUser,
  getGroup,
  getUser,
  listGroups,
  listUsers,
  organizationForScimToken,
  patchGroup,
  patchUser,
  replaceGroup,
  replaceUser,
  resourceTypes,
  schemas,
  scimTokenFromHeader,
  serviceProviderConfig,
  type ScimContext,
} from "../scim";

/**
 * SCIM 2.0 (server/scim.ts), mounted at /api/scim/v2: the organization's identity provider
 * provisions accounts and groups. No session and no role: the provider's bearer token is the
 * credential, and it names the organization — every handler acts for that organization only.
 * Answers are SCIM's own JSON (application/scim+json), errors included.
 */

export { SCIM_BASE_PATH };

const router = Router();
const logger = await loggerPromise;

/** Where the provider reaches this API: the address to give it. */
export function scimBaseUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return `${publicBase(req, env)}${SCIM_BASE_PATH}`;
}

// Providers send application/scim+json, which the application's JSON parser does not read.
router.use(express.json({ type: ["application/scim+json", "application/json"], limit: "1mb" }));

// A first synchronisation of a large directory is thousands of requests in minutes.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: process.env.NODE_ENV === "test" ? 100000 : 1200,
    store: sharedStore("scim"),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => scimError(res, new ScimError(429, "Too many requests; retry later.")),
  }),
);

function scimError(res: Response, error: ScimError) {
  res
    .status(error.status)
    .type("application/scim+json")
    .json({ schemas: [SCHEMAS.error], status: String(error.status), ...(error.scimType ? { scimType: error.scimType } : {}), detail: error.detail });
}

function context(req: Request, res: Response): ScimContext {
  return { organizationId: res.locals.scimOrganizationId as number, baseUrl: scimBaseUrl(req), ipAddress: req.ip ?? null };
}

router.use(async (req, res, next) => {
  const token = scimTokenFromHeader(req.headers.authorization);
  const organizationId = token ? await organizationForScimToken(token).catch(next) : null;
  if (organizationId === undefined) return;
  if (!organizationId) {
    if (token) logger.warn({ message: "SCIM token refused", path: req.path });
    res.setHeader("WWW-Authenticate", 'Bearer realm="WebFlowMaster SCIM"');
    return scimError(res, new ScimError(401, "A valid SCIM bearer token is required: issue one under Settings → Single sign-on."));
  }
  res.locals.scimOrganizationId = organizationId;
  next();
});

/** Runs a handler and answers in SCIM's format, its errors included. */
function scim(status: number, work: (req: Request, res: Response) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await work(req, res);
      if (status === 204) return res.status(204).end();
      const location = (body as { meta?: { location?: string } } | undefined)?.meta?.location;
      if (status === 201 && location) res.setHeader("Location", location);
      res.status(status).type("application/scim+json").send(JSON.stringify(body));
    } catch (error) {
      if (error instanceof ScimError) return scimError(res, error);
      next(error);
    }
  };
}

const query = (req: Request) => req.query as Record<string, string | undefined>;

router.get("/ServiceProviderConfig", scim(200, (req) => serviceProviderConfig(scimBaseUrl(req))));
router.get("/ResourceTypes", scim(200, (req) => resourceTypes(scimBaseUrl(req))));
router.get("/Schemas", scim(200, (req) => schemas(scimBaseUrl(req))));

router.get("/Users", scim(200, (req, res) => listUsers(context(req, res), query(req))));
router.post("/Users", scim(201, (req, res) => createUser(context(req, res), req.body ?? {})));
router.get("/Users/:id", scim(200, (req, res) => getUser(context(req, res), String(req.params.id))));
router.put("/Users/:id", scim(200, (req, res) => replaceUser(context(req, res), String(req.params.id), req.body ?? {})));
router.patch("/Users/:id", scim(200, (req, res) => patchUser(context(req, res), String(req.params.id), req.body)));
router.delete("/Users/:id", scim(204, (req, res) => deleteUser(context(req, res), String(req.params.id))));

router.get("/Groups", scim(200, (req, res) => listGroups(context(req, res), query(req))));
router.post("/Groups", scim(201, (req, res) => createGroup(context(req, res), req.body ?? {})));
router.get("/Groups/:id", scim(200, (req, res) => getGroup(context(req, res), String(req.params.id), query(req))));
router.put("/Groups/:id", scim(200, (req, res) => replaceGroup(context(req, res), String(req.params.id), req.body ?? {})));
router.patch("/Groups/:id", scim(200, (req, res) => patchGroup(context(req, res), String(req.params.id), req.body)));
router.delete("/Groups/:id", scim(204, (req, res) => deleteGroup(context(req, res), String(req.params.id))));

// Anything else under the base: SCIM's 404, not the application's.
router.use(scim(200, () => {
  throw new ScimError(404, "No such SCIM resource. This service offers Users, Groups, ServiceProviderConfig, ResourceTypes and Schemas.");
}));

export default router;
