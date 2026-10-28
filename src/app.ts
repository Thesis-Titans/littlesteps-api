import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { catalogRouter } from "./catalog/catalog-router.js";
import { requireFirebaseUser } from "./middleware/require-firebase-user.js";

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.disable("x-powered-by");
app.use(helmet());
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

app.get("/api/v1/me", requireFirebaseUser, (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ uid: request.firebaseUser!.uid });
});

app.use((_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
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
