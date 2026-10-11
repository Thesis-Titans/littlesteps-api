import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getApps, initializeApp } from "firebase-admin/app";
import type { NextFunction, Request, Response } from "express";

if (getApps().length === 0) initializeApp();

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
    }
  }
}

export async function requireFirebaseUser(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);

  if (!match) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "A valid bearer token is required" } });
    return;
  }

  try {
    request.firebaseUser = await getAuth().verifyIdToken(match[1]);
    next();
  } catch {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "A valid bearer token is required" } });
  }
}
