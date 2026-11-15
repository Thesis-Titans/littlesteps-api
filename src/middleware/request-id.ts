import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
    interface Locals {
      requestId?: string;
    }
  }
}

export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Validates whether a raw client-supplied request ID is safe and acceptable.
 * Letters, digits, dot, underscore and hyphen only, 1 to 128 characters, so it is safe in headers and logs.
 */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value.trim());
}

/**
 * Request ID middleware:
 * 1. Extracts X-Request-Id from request headers if valid, or generates a fresh UUID v4.
 * 2. Sets X-Request-Id on response headers.
 * 3. Exposes requestId on res.locals.requestId and req.id.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const raw = request.headers["x-request-id"];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;

  const requestId = isValidRequestId(headerValue) ? headerValue.trim() : randomUUID();

  response.setHeader(REQUEST_ID_HEADER, requestId);
  response.locals.requestId = requestId;
  request.id = requestId;

  next();
}

/**
 * Helper to retrieve the current request correlation ID from response locals.
 */
export function getRequestId(response: Response): string {
  return response.locals.requestId ?? "unknown";
}
