import {
  CatalogActivitySchema,
  type BookItem,
  type BooksResponse,
  type CatalogActivitiesQuery,
  type CatalogActivity
} from "./types.js";
import { SYNTHETIC_ACTIVITIES } from "./fixtures/catalog-activities.synthetic.js";
import { FALLBACK_BOOKS } from "./fixtures/books.fallback.js";

interface CacheEntry {
  timestamp: number;
  data: BooksResponse;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (per api-reference.md §5.1)
const booksCache = new Map<string, CacheEntry>();

function validateActivities(activities: CatalogActivity[]): CatalogActivity[] {
  return activities.map((item) => {
    const validated = CatalogActivitySchema.parse(item);
    // Explicit guard: draft or unreviewed content cannot be marked approved
    if (validated.status !== "reviewed_approved" && validated.status !== "synthetic_fixture") {
      throw new Error(`Invalid catalog item status for ${validated.id}: ${validated.status}`);
    }
    return validated;
  });
}

const activitiesStore: CatalogActivity[] = validateActivities(SYNTHETIC_ACTIVITIES);
const fallbackBooks: BookItem[] = FALLBACK_BOOKS;

export function getCatalogActivities(query: CatalogActivitiesQuery): { total: number; items: CatalogActivity[] } {
  let filtered = activitiesStore;

  if (query.ageBand) {
    filtered = filtered.filter((item) => item.ageBand === query.ageBand);
  }
  if (query.type) {
    filtered = filtered.filter((item) => item.type === query.type);
  }
  if (query.domain) {
    filtered = filtered.filter((item) => item.domain === query.domain);
  }
  if (query.language) {
    filtered = filtered.filter((item) => item.language === query.language);
  }
  if (query.setting) {
    filtered = filtered.filter((item) => item.setting === query.setting || item.setting === "either");
  }

  const limit = query.limit ?? 20;
  const items = filtered.slice(0, limit);

  return {
    total: filtered.length,
    items
  };
}

export function getCatalogActivityById(id: string): CatalogActivity | undefined {
  return activitiesStore.find((item) => item.id === id);
}

export async function getBooksCatalog(
  subject = "picture_books",
  limit = 12,
  fetchTimeoutMs = 3000
): Promise<{ response: BooksResponse; fromCache: boolean }> {
  const cacheKey = `${subject.toLowerCase()}:${limit}`;
  const now = Date.now();
  const cached = booksCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { response: cached.data, fromCache: true };
  }

  try {
    const upstreamUrl = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    const res = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "LittleSteps-API/0.2.0 (Thesis Academic Project)" }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Open Library returned status ${res.status}`);
    }

    const data = await res.json() as {
      work_count?: number;
      works?: Array<{
        key?: string;
        title?: string;
        authors?: Array<{ name: string }>;
        cover_id?: number;
        subject?: string[];
      }>;
    };

    const books: BookItem[] = (data.works ?? []).map((work) => {
      const rawKey = work.key ?? "";
      const id = rawKey.replace("/works/", "") || rawKey;
      return {
        id,
        title: work.title ?? "Untitled",
        authors: (work.authors ?? []).map((a) => a.name).filter(Boolean),
        coverUrl: work.cover_id ? `https://covers.openlibrary.org/b/id/${work.cover_id}-M.jpg` : null,
        subjects: (work.subject ?? []).slice(0, 5)
      };
    });

    const result: BooksResponse = {
      subject,
      totalCount: data.work_count ?? books.length,
      books,
      provenance: {
        source: "Open Library (Internet Archive)",
        license: "Public Domain / Open Access"
      }
    };

    booksCache.set(cacheKey, { timestamp: now, data: result });
    return { response: result, fromCache: false };
  } catch {
    // Graceful offline degradation per api-reference.md §5.1 & ADR-010
    const slicedFallback = fallbackBooks.slice(0, limit);
    const fallbackResponse: BooksResponse = {
      subject,
      totalCount: slicedFallback.length,
      books: slicedFallback,
      provenance: {
        source: "local-fallback",
        license: "Public Domain / Curated Academic Fixture"
      }
    };

    return { response: fallbackResponse, fromCache: false };
  }
}

export function clearBooksCache(): void {
  booksCache.clear();
}
