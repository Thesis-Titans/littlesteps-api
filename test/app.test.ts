import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("LittleSteps API scaffold", () => {
  it("returns a no-store health response", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects identity requests without a bearer token", async () => {
    const response = await request(app).get("/api/v1/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns a consistent 404 envelope", async () => {
    const response = await request(app).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns no-store on the error handler response", async () => {
    const response = await request(app).post("/missing").set("Content-Type", "application/json").send("{bad");
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("request body limits", () => {
  it("returns 413 with the standard envelope for a body over 100 KB", async () => {
    const response = await request(app)
      .post("/api/v1/children")
      .set("Authorization", "Bearer uid-a")
      .send({ nickname: "x".repeat(101 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." } });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("still returns INVALID_JSON 400 for malformed JSON", async () => {
    const response = await request(app).post("/api/v1/children").set("Content-Type", "application/json").send("{bad");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });
});

describe("CORS configuration", () => {
  it("allows localhost:5173 by default", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows 127.0.0.1:5173 by default", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://127.0.0.1:5173");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("handles OPTIONS preflight for allowed origins", async () => {
    const response = await request(app)
      .options("/health")
      .set("Origin", "http://127.0.0.1:5173")
      .set("Access-Control-Request-Method", "GET");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("rejects unauthorized origins with ORIGIN_NOT_ALLOWED 403", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://unauthorized-origin.com");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed" }
    });
  });
});
