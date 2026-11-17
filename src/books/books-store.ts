import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { stripUndefined } from "../strip-undefined.js";
import type { StoredBook } from "./types.js";

export interface BooksStore {
  list(uid: string, childId: string): Promise<StoredBook[]>;
  get(uid: string, childId: string, bookId: string): Promise<StoredBook | null>;
  save(uid: string, childId: string, book: StoredBook): Promise<boolean>;
  delete(uid: string, childId: string, bookId: string): Promise<boolean>;
  deleteAllForChild?(uid: string, childId: string): Promise<void>;
}

export const BOOKS_LIST_LIMIT = 100;

export const ownedBook = (
  uid: string,
  childId: string,
  book: StoredBook | undefined
): StoredBook | null =>
  book && book.caregiverId === uid && book.childId === childId ? book : null;

export function createFirestoreBooksStore(): BooksStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string, childId: string) =>
    getFirestore()
      .collection("caregivers")
      .doc(uid)
      .collection("children")
      .doc(childId)
      .collection("books");

  return {
    async list(uid, childId) {
      const snap = await col(uid, childId)
        .orderBy("createdAt", "desc")
        .limit(BOOKS_LIST_LIMIT)
        .get();
      return snap.docs
        .map((d) => ownedBook(uid, childId, d.data() as StoredBook))
        .filter((b): b is StoredBook => b !== null);
    },
    async get(uid, childId, bookId) {
      const snap = await col(uid, childId).doc(bookId).get();
      return snap.exists ? ownedBook(uid, childId, snap.data() as StoredBook) : null;
    },
    async save(uid, childId, book) {
      await col(uid, childId).doc(book.id).set(stripUndefined(book));
      return true;
    },
    async delete(uid, childId, bookId) {
      const docRef = col(uid, childId).doc(bookId);
      const snap = await docRef.get();
      if (!snap.exists) return false;
      const current = ownedBook(uid, childId, snap.data() as StoredBook);
      if (!current) return false;
      await docRef.delete();
      return true;
    },
    async deleteAllForChild(uid, childId) {
      const snap = await col(uid, childId).get();
      const batch = getFirestore().batch();
      for (const d of snap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  };
}

export function createInMemoryBooksStore(seed: StoredBook[] = []): BooksStore {
  const data = new Map<string, StoredBook>(seed.map((b) => [`${b.childId}:${b.id}`, b]));
  return {
    async list(uid, childId) {
      return Array.from(data.values())
        .filter((b) => b.caregiverId === uid && b.childId === childId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(uid, childId, bookId) {
      const b = data.get(`${childId}:${bookId}`);
      return b && b.caregiverId === uid ? b : null;
    },
    async save(uid, childId, book) {
      data.set(`${childId}:${book.id}`, book);
      return true;
    },
    async delete(uid, childId, bookId) {
      const b = data.get(`${childId}:${bookId}`);
      if (!b || b.caregiverId !== uid) return false;
      data.delete(`${childId}:${bookId}`);
      return true;
    },
    async deleteAllForChild(uid, childId) {
      for (const [key, b] of data.entries()) {
        if (b.caregiverId === uid && b.childId === childId) {
          data.delete(key);
        }
      }
    }
  };
}
