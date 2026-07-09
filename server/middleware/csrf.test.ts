import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { csrfOriginCheck } from "./csrf";

function makeReq(method: string, headers: Record<string, string> = {}): Request {
  return { method, headers } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: any };
}

describe("csrfOriginCheck", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
    delete process.env.CSRF_TRUSTED_ORIGINS;
  });

  it("passes safe methods without checking origin", () => {
    const res = makeRes();
    csrfOriginCheck(makeReq("GET", { origin: "https://evil.example" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it("passes same-origin state-changing requests", () => {
    const res = makeRes();
    csrfOriginCheck(makeReq("POST", { host: "app.test", origin: "https://app.test" }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin state-changing requests", () => {
    const res = makeRes();
    csrfOriginCheck(makeReq("POST", { host: "app.test", origin: "https://evil.example" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/CSRF/);
  });

  it("passes server-to-server requests with no Origin/Referer (e.g. webhooks)", () => {
    const res = makeRes();
    csrfOriginCheck(makeReq("POST", { host: "app.test" }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("falls back to Referer when Origin is absent", () => {
    const res = makeRes();
    csrfOriginCheck(makeReq("DELETE", { host: "app.test", referer: "https://app.test/page" }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("honours CSRF_TRUSTED_ORIGINS for proxied hosts", () => {
    process.env.CSRF_TRUSTED_ORIGINS = "https://public.example";
    const res = makeRes();
    csrfOriginCheck(makeReq("POST", { host: "internal:3000", origin: "https://public.example" }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("matches the X-Forwarded-Host header behind a proxy", () => {
    const res = makeRes();
    csrfOriginCheck(
      makeReq("POST", { host: "internal:3000", "x-forwarded-host": "app.test", origin: "https://app.test" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
