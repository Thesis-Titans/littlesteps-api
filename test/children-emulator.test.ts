import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../src/app.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

async function signUp(): Promise<{ idToken: string; localId: string }> {
  const email = `child-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "LocalTestPassword123!", returnSecureToken: true })
  });
  const body = (await res.json()) as { idToken?: string; localId?: string };
  if (!res.ok || !body.idToken || !body.localId) throw new Error("Could not create synthetic Auth Emulator identity");
  return { idToken: body.idToken, localId: body.localId };
}

describe("children API against the Auth and Firestore emulators", () => {
  beforeAll(() => {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must be set. Run through npm run test:emulator.");
    }
  });

  it("runs create, list, get and patch for one caregiver and stores under the caller's path only", async () => {
    const a = await signUp();
    const auth = { Authorization: `Bearer ${a.idToken}` };

    const created = await request(app).post("/api/v1/children").set(auth).send({ nickname: "Sample Child", ageBand: "12-23m", uid: "attacker" });
    expect(created.status).toBe(400);

    const ok = await request(app).post("/api/v1/children").set(auth).send({ nickname: "Sample Child", ageBand: "12-23m" });
    expect(ok.status).toBe(201);
    const id = ok.body.id as string;

    const list = await request(app).get("/api/v1/children").set(auth);
    expect(list.body).toEqual([ok.body]);
    expect((await request(app).get(`/api/v1/children/${id}`).set(auth)).body).toEqual(ok.body);

    const patched = await request(app).patch(`/api/v1/children/${id}`).set(auth).send({ nickname: "Sample Sprout" });
    expect(patched.status).toBe(200);
    expect(patched.body.nickname).toBe("Sample Sprout");
    expect(patched.body.createdAt).toBe(ok.body.createdAt);

    const db = getFirestore();
    const doc = await db.collection("caregivers").doc(a.localId).collection("children").doc(id).get();
    expect(doc.data()).toMatchObject({ id, caregiverId: a.localId, name: "Sample Sprout", ageBand: "12-23m" });
    const all = await db.collectionGroup("children").where("id", "==", id).get();
    expect(all.docs.map((d) => d.ref.path)).toEqual([`caregivers/${a.localId}/children/${id}`]);
  });

  it("isolates two real caregivers", async () => {
    const a = await signUp();
    const b = await signUp();
    const authA = { Authorization: `Bearer ${a.idToken}` };
    const authB = { Authorization: `Bearer ${b.idToken}` };
    const child = (await request(app).post("/api/v1/children").set(authB).send({ nickname: "Theirs", ageBand: "0-5m" })).body;

    expect((await request(app).get("/api/v1/children").set(authA)).body).toEqual([]);
    const cross = await request(app).get(`/api/v1/children/${child.id}`).set(authA);
    const missing = await request(app).get("/api/v1/children/8c2bce8d-9066-428d-aafa-c26761845c6e").set(authA);
    expect(cross.status).toBe(404);
    expect(cross.text).toBe(missing.text);

    const patch = await request(app).patch(`/api/v1/children/${child.id}`).set(authA).send({ nickname: "Hijack" });
    expect(patch.status).toBe(404);
    expect((await request(app).get(`/api/v1/children/${child.id}`).set(authB)).body.nickname).toBe("Theirs");
  });

  it("keeps both fields when two PATCHes run concurrently", async () => {
    const a = await signUp();
    const auth = { Authorization: `Bearer ${a.idToken}` };
    const id = (await request(app).post("/api/v1/children").set(auth).send({ nickname: "Before", ageBand: "0-5m" })).body.id as string;
    const [r1, r2] = await Promise.all([
      request(app).patch(`/api/v1/children/${id}`).set(auth).send({ nickname: "After" }),
      request(app).patch(`/api/v1/children/${id}`).set(auth).send({ ageBand: "24-35m" })
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const got = (await request(app).get(`/api/v1/children/${id}`).set(auth)).body;
    expect(got).toMatchObject({ nickname: "After", ageBand: "24-35m" });
  });

  it("lists the first 50 children by createdAt when there are more", async () => {
    const a = await signUp();
    const col = getFirestore().collection("caregivers").doc(a.localId).collection("children");
    const batch = getFirestore().batch();
    for (let n = 54; n >= 0; n--) {
      const id = `00000000-0000-4000-8000-${String(100000 - n).padStart(12, "0")}`;
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
      batch.set(col.doc(id), { id, caregiverId: a.localId, name: `C${n}`, ageBand: "0-5m", createdAt: t, updatedAt: t });
    }
    await batch.commit();
    const list = await request(app).get("/api/v1/children").set({ Authorization: `Bearer ${a.idToken}` });
    expect(list.body.map((c: { nickname: string }) => c.nickname)).toEqual(Array.from({ length: 50 }, (_, n) => `C${n}`));
  });

  it("caps a caregiver at 20 children under concurrent creates", async () => {
    const a = await signUp();
    const auth = { Authorization: `Bearer ${a.idToken}` };
    const post = () => request(app).post("/api/v1/children").set(auth).send({ nickname: "Kid", ageBand: "0-5m" });
    const col = getFirestore().collection("caregivers").doc(a.localId).collection("children");
    const statuses: number[] = [];
    // Four small waves of 5: contended transactions may answer 503, which is retried one at a time.
    for (let wave = 0; wave < 4; wave++) statuses.push(...(await Promise.all(Array.from({ length: 5 }, post))).map((r) => r.status));
    for (let tries = 0; tries < 100 && (await col.get()).size < 20; tries++) statuses.push((await post()).status);
    expect(statuses.every((s) => s === 201 || s === 503)).toBe(true);
    expect((await col.get()).size).toBe(20);
    const extra = await post();
    expect(extra.status).toBe(422);
    expect(extra.body.error.details).toEqual([{ field: "children", issue: "Limit of 20 children reached" }]);
    expect((await col.get()).size).toBe(20);
  }, 60_000);

  it("stores exactly 20 when 12 creates race twice, allowing 503 retries", async () => {
    const a = await signUp();
    const auth = { Authorization: `Bearer ${a.idToken}` };
    const post = () => request(app).post("/api/v1/children").set(auth).send({ nickname: "Kid", ageBand: "0-5m" });
    const col = getFirestore().collection("caregivers").doc(a.localId).collection("children");
    const statuses: number[] = [];
    for (const n of [12, 12]) statuses.push(...(await Promise.all(Array.from({ length: n }, post))).map((r) => r.status));
    // Retry transient 503s one at a time until the caregiver has 20 or gets a 422.
    for (let tries = 0; tries < 100 && (await col.get()).size < 20; tries++) {
      const status = (await post()).status;
      statuses.push(status);
      if (status === 422) break;
    }
    expect(statuses.every((s) => [201, 422, 503].includes(s))).toBe(true);
    expect(statuses).not.toContain(500);
    expect((await col.get()).size).toBe(20);
  }, 60_000);
});
