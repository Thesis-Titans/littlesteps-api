import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const apiKey = "fake-api-key";

async function createEmulatorIdToken(): Promise<{ idToken: string; localId: string }> {
  const email = `test-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const response = await fetch(
    `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "LocalTestPassword123!",
        returnSecureToken: true
      })
    }
  );

  const body = (await response.json()) as {
    idToken?: string;
    localId?: string;
    error?: { message?: string };
  };

  if (!response.ok || !body.idToken || !body.localId) {
    throw new Error(
      `Could not create synthetic Auth Emulator identity: ${body.error?.message ?? response.status}`
    );
  }

  return { idToken: body.idToken, localId: body.localId };
}

describe("Firebase Auth Emulator integration", () => {
  beforeAll(() => {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error(
        "FIREBASE_AUTH_EMULATOR_HOST must be set. Run this suite through npm run test:emulator."
      );
    }
  });

  it("rejects a malformed bearer token", async () => {
    const response = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer not-a-valid-firebase-token");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an invalid token without exposing verification details", async () => {
    const response = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer invalid.token.value");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(response.body)).not.toMatch(/signature|stack|FirebaseError/i);
  });

  it("accepts an Auth Emulator ID token and derives identity from the verified token", async () => {
    const { idToken, localId } = await createEmulatorIdToken();

    const response = await request(app)
      .get("/api/v1/me?uid=client-supplied-attacker")
      .set("Authorization", `Bearer ${idToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ uid: localId });
    expect(response.body.uid).not.toBe("client-supplied-attacker");
  });
});
