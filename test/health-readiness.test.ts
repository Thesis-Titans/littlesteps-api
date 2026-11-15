import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, setFirestorePingFn } from "../src/app.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Health & Readiness Probes and Observability", () => {
  beforeEach(() => {
    // Default mock ping succeeds for offline tests
    setFirestorePingFn(async () => {});
  });

  afterEach(() => {
    setFirestorePingFn(undefined);
    vi.restoreAllMocks();
  });

  describe("GET /health (Liveness)", () => {
    it("returns 200 with status ok and cache-control no-store", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("attaches a generated X-Request-Id header when none is provided", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-request-id"]).toMatch(UUID_V4_REGEX);
    });

    it("replaces a client X-Request-Id that has unsafe characters", async () => {
      const res = await request(app).get("/health").set("X-Request-Id", "bad id;<script>");
      expect(res.headers["x-request-id"]).toMatch(UUID_V4_REGEX);
    });

    it("preserves a valid client-supplied X-Request-Id header", async () => {
      const customId = "client-trace-abc-123";
      const res = await request(app).get("/health").set("X-Request-Id", customId);
      expect(res.headers["x-request-id"]).toBe(customId);
    });
  });

  describe("GET /ready (Readiness)", () => {
    it("returns 200 ready when Firestore ping succeeds", async () => {
      setFirestorePingFn(async () => {
        // Mock successful ping
      });
      const res = await request(app).get("/ready");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ready", firestore: "connected" });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-request-id"]).toMatch(UUID_V4_REGEX);
    });

    it("reuses a successful check instead of reading Firestore on every call", async () => {
      const ping = vi.fn(async () => {});
      setFirestorePingFn(ping);
      await request(app).get("/ready");
      await request(app).get("/ready");
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it("returns 503 SERVICE_UNAVAILABLE when Firestore ping fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      setFirestorePingFn(async () => {
        throw new Error("Simulated Firestore timeout");
      });

      const res = await request(app).get("/ready");
      expect(res.status).toBe(503);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-request-id"]).toMatch(UUID_V4_REGEX);
      expect(res.body).toEqual({
        status: "unhealthy",
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Firestore connection failed",
          requestId: res.headers["x-request-id"]
        }
      });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData).toMatchObject({
        event: "health.readiness_failed",
        requestId: res.headers["x-request-id"],
        error: "Simulated Firestore timeout"
      });
    });

    it("propagates client X-Request-Id into 503 error payload", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setFirestorePingFn(async () => {
        throw new Error("Connection refused");
      });

      const customId = "custom-ready-fail-uuid";
      const res = await request(app).get("/ready").set("X-Request-Id", customId);
      expect(res.status).toBe(503);
      expect(res.headers["x-request-id"]).toBe(customId);
      expect(res.body.error.requestId).toBe(customId);
    });
  });

  describe("Request ID Middleware & Error Envelopes", () => {
    it("generates UUID v4 if incoming X-Request-Id is blank whitespace", async () => {
      const res = await request(app).get("/health").set("X-Request-Id", "   ");
      expect(res.headers["x-request-id"]).toMatch(UUID_V4_REGEX);
    });

    it("includes requestId in 404 RESOURCE_NOT_FOUND responses", async () => {
      const customId = "not-found-id-789";
      const res = await request(app).get("/non-existent-route").set("X-Request-Id", customId);
      expect(res.status).toBe(404);
      expect(res.headers["x-request-id"]).toBe(customId);
      expect(res.body).toEqual({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Resource not found",
          requestId: customId
        }
      });
    });

    it("includes requestId and logs structured JSON in 400 INVALID_JSON responses", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const customId = "bad-json-trace-999";
      const res = await request(app)
        .post("/missing")
        .set("Content-Type", "application/json")
        .set("X-Request-Id", customId)
        .send("{malformed");

      expect(res.status).toBe(400);
      expect(res.headers["x-request-id"]).toBe(customId);
      expect(res.body.error).toEqual({
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
        requestId: customId
      });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData).toMatchObject({
        event: "api.error",
        requestId: customId,
        code: "INVALID_JSON"
      });
    });

    it("includes requestId and logs structured JSON in 413 PAYLOAD_TOO_LARGE responses", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const customId = "payload-trace-413";
      const res = await request(app)
        .post("/api/v1/children")
        .set("Authorization", "Bearer uid-a")
        .set("X-Request-Id", customId)
        .send({ nickname: "x".repeat(101 * 1024) });

      expect(res.status).toBe(413);
      expect(res.headers["x-request-id"]).toBe(customId);
      expect(res.body.error).toEqual({
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is too large.",
        requestId: customId
      });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData).toMatchObject({
        event: "api.error",
        requestId: customId,
        code: "PAYLOAD_TOO_LARGE"
      });
    });

    it("includes requestId and logs structured JSON in 403 ORIGIN_NOT_ALLOWED responses", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const customId = "cors-trace-403";
      const res = await request(app)
        .get("/health")
        .set("Origin", "http://unauthorized-origin.com")
        .set("X-Request-Id", customId);

      expect(res.status).toBe(403);
      expect(res.headers["x-request-id"]).toBe(customId);
      expect(res.body.error).toEqual({
        code: "ORIGIN_NOT_ALLOWED",
        message: "Origin is not allowed",
        requestId: customId
      });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData).toMatchObject({
        event: "api.error",
        requestId: customId,
        code: "ORIGIN_NOT_ALLOWED"
      });
    });

    it("exposes X-Request-Id in CORS headers for cross-origin callers", async () => {
      const res = await request(app)
        .get("/health")
        .set("Origin", "http://localhost:5173");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-expose-headers"]).toContain("X-Request-Id");
    });
  });
});
