import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import { getRequestId } from "../middleware/request-id.js";

export type FirestorePingFn = () => Promise<void>;

const FIRESTORE_PING_TIMEOUT_MS = 3000;

/**
 * Production canary query against Firestore:
 * Performs a read against the sentinel "health" collection with a 3-second timeout.
 */
export const defaultFirestorePing: FirestorePingFn = async (): Promise<void> => {
  if (getApps().length === 0) initializeApp();
  const db = getFirestore();

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Firestore connection timed out"));
    }, FIRESTORE_PING_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
  });

  await Promise.race([
    db.collection("health").limit(1).get(),
    timeoutPromise
  ]);
};

let currentPingFn: FirestorePingFn | undefined;

// Public route that costs a Firestore read: reuse a successful check for 10 seconds.
const READY_CACHE_MS = 10_000;
let lastOkAt = 0;

/**
 * Dependency injection for testing:
 * Allows tests to supply mock ping functions without requiring emulators or live network.
 */
export function setFirestorePingFn(fn: FirestorePingFn | undefined): void {
  currentPingFn = fn;
  lastOkAt = 0;
}

export function getFirestorePingFn(): FirestorePingFn {
  return currentPingFn ?? defaultFirestorePing;
}

/**
 * Handler for GET /ready:
 * - Returns 200 { status: "ready", firestore: "connected" } when ping succeeds.
 * - Returns 503 { status: "unhealthy", error: { code: "SERVICE_UNAVAILABLE", message: "Firestore connection failed", requestId } } when ping fails.
 */
export async function readyHandler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  const requestId = getRequestId(response);

  try {
    if (Date.now() - lastOkAt >= READY_CACHE_MS) {
      const ping = getFirestorePingFn();
      await ping();
      lastOkAt = Date.now();
    }
    response.status(200).json({
      status: "ready",
      firestore: "connected"
    });
  } catch (error) {
    lastOkAt = 0;
    const errorMessage = error instanceof Error ? error.message : "Firestore connection failed";
    console.error(JSON.stringify({
      event: "health.readiness_failed",
      requestId,
      error: errorMessage
    }));
    response.status(503).json({
      status: "unhealthy",
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Firestore connection failed",
        requestId
      }
    });
  }
}
