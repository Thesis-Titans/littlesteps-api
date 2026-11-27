import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  CatalogActivitySchema,
  CatalogMilestoneSchema,
  CatalogRhymeSchema,
  type CatalogActivity,
  type CatalogMilestone,
  type CatalogRhyme
} from "./types.js";

export interface ReadOnlyCollectionStore<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  clearCache?(): void;
}

export type CatalogStore = ReadOnlyCollectionStore<CatalogActivity>;
export type MilestoneCatalogStore = ReadOnlyCollectionStore<CatalogMilestone>;
export type RhymeCatalogStore = ReadOnlyCollectionStore<CatalogRhyme>;

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

function createFirestoreCollectionStore<T extends { id: string }>(
  collectionName: string,
  parse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown[] } },
  ttlMs = DEFAULT_CACHE_TTL_MS
): ReadOnlyCollectionStore<T> {
  if (getApps().length === 0) initializeApp();

  let cachedItems: T[] | null = null;
  let cachedAt = 0;

  async function loadAll(): Promise<T[]> {
    const now = Date.now();
    if (cachedItems !== null && now - cachedAt < ttlMs) {
      return cachedItems;
    }

    const snap = await getFirestore().collection(collectionName).get();
    const items: T[] = [];

    for (const doc of snap.docs) {
      const parsed = parse({ id: doc.id, ...doc.data() });
      if (parsed.success) {
        items.push(parsed.data);
      } else {
        console.warn(
          JSON.stringify({
            event: "catalog.invalid_document",
            collection: collectionName,
            docId: doc.id,
            issueCount: parsed.error.issues.length
          })
        );
      }
    }

    items.sort((a, b) => a.id.localeCompare(b.id));
    cachedItems = items;
    cachedAt = now;
    return items;
  }

  return {
    async list() {
      return loadAll();
    },
    async get(id) {
      const items = await loadAll();
      return items.find((item) => item.id === id) ?? null;
    },
    clearCache() {
      cachedItems = null;
      cachedAt = 0;
    }
  };
}

function createInMemoryCollectionStore<T extends { id: string }>(
  seed: T[] = []
): ReadOnlyCollectionStore<T> {
  const items = [...seed];
  return {
    async list() {
      return items;
    },
    async get(id) {
      return items.find((item) => item.id === id) ?? null;
    }
  };
}

/** Firestore-backed store for `catalog_activities` with 5-minute TTL cache. */
export function createFirestoreCatalogStore(ttlMs = DEFAULT_CACHE_TTL_MS): CatalogStore {
  return createFirestoreCollectionStore("catalog_activities", (d) => CatalogActivitySchema.safeParse(d), ttlMs);
}

/** In-memory activity catalog store used by unit and integration tests. */
export function createInMemoryCatalogStore(seed: CatalogActivity[] = []): CatalogStore {
  return createInMemoryCollectionStore(seed);
}

/** Firestore-backed store for `catalog_milestones` with 5-minute TTL cache. */
export function createFirestoreMilestoneCatalogStore(ttlMs = DEFAULT_CACHE_TTL_MS): MilestoneCatalogStore {
  return createFirestoreCollectionStore("catalog_milestones", (d) => CatalogMilestoneSchema.safeParse(d), ttlMs);
}

/** In-memory milestone prompt store used by unit and integration tests. */
export function createInMemoryMilestoneCatalogStore(seed: CatalogMilestone[] = []): MilestoneCatalogStore {
  return createInMemoryCollectionStore(seed);
}

/** Firestore-backed store for `catalog_rhymes` with 5-minute TTL cache. */
export function createFirestoreRhymeCatalogStore(ttlMs = DEFAULT_CACHE_TTL_MS): RhymeCatalogStore {
  return createFirestoreCollectionStore("catalog_rhymes", (d) => CatalogRhymeSchema.safeParse(d), ttlMs);
}

/** In-memory rhyme catalog store used by unit and integration tests. */
export function createInMemoryRhymeCatalogStore(seed: CatalogRhyme[] = []): RhymeCatalogStore {
  return createInMemoryCollectionStore(seed);
}
