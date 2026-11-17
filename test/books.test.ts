import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid-")) throw new Error("bad token");
      return { uid: token };
    }
  })
}));

import { app } from "../src/app.js";
import { setChildrenStore } from "../src/children/children-router.js";
import { createMemoryChildrenStore } from "../src/children/children-store.js";
import { setPlansStore } from "../src/activities/activities-router.js";
import { createMemoryPlansStore } from "../src/activities/activities-store.js";
import { setMilestonesStore } from "../src/milestones/milestones-router.js";
import { createMemoryMilestonesStore } from "../src/milestones/milestones-store.js";
import { setJournalStore } from "../src/journal/journal-router.js";
import { createMemoryJournalStore } from "../src/journal/journal-store.js";
import { setBooksStore } from "../src/books/books-router.js";
import { createInMemoryBooksStore } from "../src/books/books-store.js";
import type { StoredChild } from "../src/children/types.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let booksStore: ReturnType<typeof createInMemoryBooksStore>;
let childA: StoredChild;
let childB: StoredChild;

beforeEach(async () => {
  childrenStore = createMemoryChildrenStore();
  setChildrenStore(childrenStore);
  setPlansStore(createMemoryPlansStore());
  setMilestonesStore(createMemoryMilestonesStore());
  setJournalStore(createMemoryJournalStore());
  booksStore = createInMemoryBooksStore();
  setBooksStore(booksStore);

  const now = new Date().toISOString();
  childA = {
    id: "11111111-1111-4111-8111-111111111111",
    caregiverId: "uid-a",
    name: "Maya",
    ageBand: "12-23m",
    createdAt: now,
    updatedAt: now
  };
  childB = {
    id: "22222222-2222-4222-8222-222222222222",
    caregiverId: "uid-b",
    name: "Liam",
    ageBand: "24-35m",
    createdAt: now,
    updatedAt: now
  };

  await childrenStore.create("uid-a", childA);
  await childrenStore.create("uid-b", childB);
});

describe("GET /api/v1/children/:childId/books", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get(`/api/v1/children/${childA.id}/books`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when childId does not exist", async () => {
    const res = await request(app)
      .get(`/api/v1/children/${MISSING_UUID}/books`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(404);
  });

  it("returns 404 when child belongs to another caregiver (BOLA isolation)", async () => {
    const res = await request(app)
      .get(`/api/v1/children/${childB.id}/books`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(404);
  });

  it("returns empty book list when child has no saved books", async () => {
    const res = await request(app)
      .get(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      books: [],
      totalCount: 0
    });
  });

  it("returns saved books sorted by createdAt descending", async () => {
    await booksStore.save("uid-a", childA.id, {
      id: "book-1",
      childId: childA.id,
      caregiverId: "uid-a",
      title: "Goodnight Moon",
      authors: ["Margaret Wise Brown"],
      subjects: ["Bedtime"],
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z"
    });

    await booksStore.save("uid-a", childA.id, {
      id: "book-2",
      childId: childA.id,
      caregiverId: "uid-a",
      title: "The Very Hungry Caterpillar",
      authors: ["Eric Carle"],
      subjects: ["Caterpillars", "Counting"],
      createdAt: "2026-11-02T10:00:00.000Z",
      updatedAt: "2026-11-02T10:00:00.000Z"
    });

    const res = await request(app)
      .get(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A);

    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(2);
    expect(res.body.books[0].id).toBe("book-2");
    expect(res.body.books[1].id).toBe("book-1");
    expect(res.body.books[0].caregiverId).toBeUndefined(); // Caregiver ID stripped
  });
});

describe("POST /api/v1/children/:childId/books", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .send({ id: "OL123W", title: "Corduroy" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when child belongs to another caregiver", async () => {
    const res = await request(app)
      .post(`/api/v1/children/${childB.id}/books`)
      .set("Authorization", AUTH_A)
      .send({ id: "OL123W", title: "Corduroy" });
    expect(res.status).toBe(404);
  });

  it("validates required fields and rejects invalid payloads with 400", async () => {
    const res = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A)
      .send({ id: "", title: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects non-HTTPS coverUrl with 400", async () => {
    const res = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A)
      .send({
        id: "OL123W",
        title: "Corduroy",
        coverUrl: "http://insecure.example.com/cover.jpg"
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("successfully saves a storybook with 201 Created", async () => {
    const res = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A)
      .send({
        id: "OL45804W",
        title: "Where the Wild Things Are",
        authors: ["Maurice Sendak"],
        coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
        subjects: ["Bedtime", "Monsters"]
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("OL45804W");
    expect(res.body.title).toBe("Where the Wild Things Are");
    expect(res.body.authors).toEqual(["Maurice Sendak"]);
    expect(res.body.coverUrl).toBe("https://covers.openlibrary.org/b/id/12345-M.jpg");
    expect(res.body.subjects).toEqual(["Bedtime", "Monsters"]);
    expect(res.body.childId).toBe(childA.id);
    expect(res.body.createdAt).toBeDefined();

    // Verify persisted
    const stored = await booksStore.get("uid-a", childA.id, "OL45804W");
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe("Where the Wild Things Are");
  });

  it("updates existing record idempotently when saving same ID again", async () => {
    const res1 = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A)
      .send({
        id: "OL45804W",
        title: "Where the Wild Things Are",
        authors: ["Maurice Sendak"]
      });
    expect(res1.status).toBe(201);
    const createdAt1 = res1.body.createdAt;

    const res2 = await request(app)
      .post(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A)
      .send({
        id: "OL45804W",
        title: "Where the Wild Things Are (Updated Edition)",
        authors: ["Maurice Sendak"],
        subjects: ["Classics"]
      });
    expect(res2.status).toBe(201);
    expect(res2.body.title).toBe("Where the Wild Things Are (Updated Edition)");
    expect(res2.body.createdAt).toBe(createdAt1); // Preserves original creation timestamp

    // Ensure list count is still 1
    const listRes = await request(app)
      .get(`/api/v1/children/${childA.id}/books`)
      .set("Authorization", AUTH_A);
    expect(listRes.body.totalCount).toBe(1);
  });
});

describe("DELETE /api/v1/children/:childId/books/:bookId", () => {
  beforeEach(async () => {
    await booksStore.save("uid-a", childA.id, {
      id: "book-delete-me",
      childId: childA.id,
      caregiverId: "uid-a",
      title: "To Be Deleted",
      authors: ["Author"],
      subjects: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  it("returns 404 when book does not exist", async () => {
    const res = await request(app)
      .delete(`/api/v1/children/${childA.id}/books/non-existent-book`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(404);
  });

  it("returns 404 when trying to delete another user's book", async () => {
    const res = await request(app)
      .delete(`/api/v1/children/${childA.id}/books/book-delete-me`)
      .set("Authorization", AUTH_B);
    expect(res.status).toBe(404);
  });

  it("successfully deletes the book and returns 204 No Content", async () => {
    const res = await request(app)
      .delete(`/api/v1/children/${childA.id}/books/book-delete-me`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(204);

    const check = await booksStore.get("uid-a", childA.id, "book-delete-me");
    expect(check).toBeNull();
  });
});

describe("Cascade deletion", () => {
  it("deleting a child removes all their saved books", async () => {
    await booksStore.save("uid-a", childA.id, {
      id: "book-cascade",
      childId: childA.id,
      caregiverId: "uid-a",
      title: "Cascade Book",
      authors: ["Author"],
      subjects: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const res = await request(app)
      .delete(`/api/v1/children/${childA.id}`)
      .set("Authorization", AUTH_A);
    expect(res.status).toBe(204);

    const check = await booksStore.get("uid-a", childA.id, "book-cascade");
    expect(check).toBeNull();
  });
});
