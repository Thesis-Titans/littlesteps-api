import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { aiRateLimit, parseTrustProxyHops } from "./ai/rate-limit.js";
import { aiRouter } from "./ai/ai-router.js";
import { catalogRouter } from "./catalog/catalog-router.js";
import { childrenRouter } from "./children/children-router.js";
import { requireFirebaseUser } from "./middleware/require-firebase-user.js";

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.disable("x-powered-by");
// One trusted proxy hop (the Google front end on Cloud Functions): req.ip is then the rightmost
// X-Forwarded-For entry, which that proxy appends. Earlier entries are client-supplied and are ignored.
// shortcut: not verified on a deployed function; if more proxies sit in front, per-IP counts will be wrong.
// Hop count comes from TRUST_PROXY_HOPS (default 1); verify it on a deployed function.
app.set("trust proxy", parseTrustProxyHops(process.env.TRUST_PROXY_HOPS));
app.use(helmet());
// Default for every route, including errors; the catalog router overrides it with its public caching.
app.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
  maxAge: 600
}));
app.use(express.json({ limit: "100kb", strict: true }));

app.get("/health", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ status: "ok" });
});

app.use("/api/v1/catalog", catalogRouter);
app.use("/api/v1/children", requireFirebaseUser, childrenRouter);

app.use("/api/v1/ai", requireFirebaseUser, aiRateLimit, aiRouter);

app.get("/api/v1/me", requireFirebaseUser, (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ uid: request.firebaseUser!.uid });
});

app.use((_request, response) => {
  response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if ((error as { type?: unknown } | null)?.type === "entity.too.large") {
    response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." } });
    return;
  }
  if (error instanceof SyntaxError) {
    response.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } });
    return;
  }
  if (error instanceof Error && error.message === "Origin not allowed") {
    response.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed" } });
    return;
  }
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
};

app.use(errorHandler);
export { app };
