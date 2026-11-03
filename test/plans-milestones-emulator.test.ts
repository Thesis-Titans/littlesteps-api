import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../src/app.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

async function signUp(): Promise<{ idToken: string; localId: string }> {
  const email = `plan-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "LocalTestPassword123!", returnSecureToken: true })
  });
  const body = (await res.json()) as { idToken?: string; localId?: string };
  if (!res.ok || !body.idToken || !body.localId) throw new Error("Could not create synthetic Auth Emulator identity");
  return { idToken: body.idToken, localId: body.localId };
}

async function setup() {
  const a = await signUp();
  const auth = { Authorization: `Bearer ${a.idToken}` };
  const child = await request(app).post("/api/v1/children").set(auth).send({ nickname: "Sample Child", ageBand: "12-23m" });
  expect(child.status).toBe(201);
  const base = `/api/v1/children/${child.body.id as string}`;
  const col = (name: string) =>
    getFirestore().collection("caregivers").doc(a.localId).collection("children").doc(child.body.id).collection(name);
  return { auth, base, col };
}

describe("plans and milestones against the Firestore emulator", () => {
  beforeAll(() => {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must be set. Run through npm run test:emulator.");
    }
  });

  it("creates a plan with only activityId and scheduledDate, completes it, then undoes it", async () => {
    const { auth, base, col } = await setup();
    const created = await request(app).post(`${base}/plans`).set(auth).send({ activityId: "act-1", scheduledDate: "2026-11-05" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const done = await request(app).patch(`${base}/plans/${id}`).set(auth).send({ status: "completed" });
    expect(done.status).toBe(200);
    expect(done.body.completedAt).toBeTruthy();
    expect((await col("plans").doc(id).get()).data()).toHaveProperty("completedAt");

    const undo = await request(app).patch(`${base}/plans/${id}`).set(auth).send({ status: "planned" });
    expect(undo.status).toBe(200);
    expect(undo.body.status).toBe("planned");
    expect(undo.body).not.toHaveProperty("completedAt");
    expect((await col("plans").doc(id).get()).data()).not.toHaveProperty("completedAt");
  });

  it("creates and patches a milestone observation with optional fields omitted", async () => {
    const { auth, base } = await setup();
    const created = await request(app).post(`${base}/milestones`).set(auth).send({ milestoneId: "ms-1", status: "not_sure" });
    expect(created.status).toBe(201);
    const patched = await request(app).patch(`${base}/milestones/ms-1`).set(auth).send({ status: "observed" });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("observed");
  });
});
