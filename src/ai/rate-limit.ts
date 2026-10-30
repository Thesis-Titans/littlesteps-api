import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { NextFunction, Request, Response } from "express";

export const WINDOW_MS = 60 * 60 * 1000;
export const USER_LIMIT = 10;
export const IP_LIMIT = 30;

const nonNegativeInt = (raw: string | undefined, fallback: number): number =>
  raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : fallback;

/** AI_IP_LIMIT_PER_HOUR: default 30, 0 disables the per-IP cap, invalid values fall back to 30. */
export const parseIpLimit = (raw: string | undefined): number => nonNegativeInt(raw, IP_LIMIT);
/** TRUST_PROXY_HOPS: default 1, integer >= 0, invalid values fall back to 1. */
export const parseTrustProxyHops = (raw: string | undefined): number => nonNegativeInt(raw, 1);

export interface RateLimitResult {
  allowed: boolean;
  /** Real seconds until the current window ends. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one request for the key and says whether it is within the limit. */
  hit(key: string): Promise<RateLimitResult>;
}

type Clock = () => number;

// Fixed window per clock hour: a burst across an hour boundary can use up to twice the limit.
const bucketOf = (nowMs: number): number => Math.floor(nowMs / WINDOW_MS);
const retryAfter = (nowMs: number): number =>
  Math.min(3600, Math.max(1, Math.ceil(((bucketOf(nowMs) + 1) * WINDOW_MS - nowMs) / 1000)));

/**
 * In-memory counters. Used for tests and for the per-IP cap.
 * shortcut: state is per Cloud Functions instance and lost on restart, so the IP cap is best effort;
 * upgrade to a shared store if abuse shows up.
 */
export function createMemoryRateLimiter(limit: number, now: Clock = Date.now): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async hit(key) {
      const t = now();
      const bucket = bucketOf(t);
      for (const k of counts.keys()) if (!k.endsWith(`|${bucket}`)) counts.delete(k);
      const id = `${key}|${bucket}`;
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return { allowed: count <= limit, retryAfterSeconds: retryAfter(t) };
    }
  };
}

/**
 * One document per user per hour: rate_limits/{uid}_{bucket} holding only uid, bucket, count and expiresAt.
 * A transaction keeps concurrent requests from over-counting. Add a Firestore TTL policy on
 * rate_limits.expiresAt so old windows are deleted.
 */
export function createFirestoreRateLimiter(limit: number, now: Clock = Date.now): RateLimiter {
  if (getApps().length === 0) initializeApp();
  return {
    async hit(uid) {
      const t = now();
      const bucket = bucketOf(t);
      const ref = getFirestore().collection("rate_limits").doc(`${uid}_${bucket}`);
      const allowed = await getFirestore().runTransaction(async (tx) => {
        const count = ((await tx.get(ref)).data()?.count as number | undefined) ?? 0;
        if (count >= limit) return false;
        tx.set(ref, { uid, bucket, count: count + 1, expiresAt: Timestamp.fromMillis((bucket + 2) * WINDOW_MS) });
        return true;
      }, { maxAttempts: 10 });
      return { allowed, retryAfterSeconds: retryAfter(t) };
    }
  };
}

// Per-user limiter has no default here: index.ts wires the Firestore one, tests inject their own.
let userLimiter: RateLimiter | null = null;
/** A limit of 0 disables the per-IP cap: no limiter, so no IP is counted at all. */
export const createIpRateLimiter = (limit: number): RateLimiter | null => (limit > 0 ? createMemoryRateLimiter(limit) : null);
let ipLimiter: RateLimiter | null = createIpRateLimiter(parseIpLimit(process.env.AI_IP_LIMIT_PER_HOUR));

export function setRateLimiter(next: RateLimiter | null): void {
  userLimiter = next;
}
export function setIpRateLimiter(next: RateLimiter | null): void {
  ipLimiter = next;
}

async function check(limiter: RateLimiter | null, key: string | undefined): Promise<RateLimitResult | null> {
  if (!limiter || !key) return null;
  try {
    const result = await limiter.hit(key);
    return result.allowed ? null : result;
  } catch {
    // Fail open so a store outage does not take suggestions down. Event name only, no user data.
    console.warn(JSON.stringify({ event: "ai.rate_limit_unavailable" }));
    return null;
  }
}

/** Counts every authenticated request, valid or not, before the provider is called. */
export async function aiRateLimit(request: Request, response: Response, next: NextFunction): Promise<void> {
  // IP first: it is cheap and keeps a blocked address from writing to Firestore.
  const blocked = (await check(ipLimiter, request.ip)) ?? (await check(userLimiter, request.firebaseUser!.uid));
  if (blocked) {
    response.setHeader("Retry-After", String(blocked.retryAfterSeconds));
    response.status(429).json({
      error: { code: "RATE_LIMITED", message: "You have reached the hourly limit for suggestions. Please try again later." }
    });
    return;
  }
  next();
}
