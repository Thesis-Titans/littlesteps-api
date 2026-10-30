# LittleSteps API

Node.js + TypeScript API using Express hosted by Firebase Cloud Functions (2nd gen). Health, authenticated identity (`/me`), catalog, child-profile routes and AI recommendations (`POST /api/v1/ai/recommendations`, deterministic fallback only; no AI provider is configured yet) are implemented, with server-side ownership checks. Rate limiting is implemented on the AI recommendations endpoint only; other abuse protection, AI provider integration, data export and deletion are not implemented yet.

---

## Canonical Project Documentation
LittleSteps uses a three-tier documentation structure. System architecture, product scope, and privacy policies are maintained centrally in [`littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs):

- [Developer Onboarding Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/getting-started.md): Full-stack local setup instructions.
- [API Reference & Integration Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/api-reference.md): Canonical OpenAPI contract, Open Library REST integration, 3-tier AI fallback engine, and error envelopes.
- [Product Scope](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/product-scope.md): The six core features and boundaries.
- [Architecture Decisions](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/architecture-decisions.md): Architecture and technical direction (ADRs 001–010).
- [Security, Privacy, and AI Guardrails](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/security-privacy-ai.md): Data safeguards and child privacy principles.
- [Documentation Standards](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/documentation-standards.md): Documentation hierarchy and repository consistency.

---

## Requirements
- **Node.js 22 LTS**
- **npm 10+**
- **Java 21** (for Firebase Emulator Suite workflows)

---

## Local Setup & Verification
1. Copy `.env.example` to `.env` and configure comma-separated `CORS_ORIGINS` for local web origins. Do not commit secrets.
   - Optional `OPEN_LIBRARY_CONTACT`: a contact email or phone added to the Open Library User-Agent. Open Library asks API users for an app name and a contact email or phone: https://openlibrary.org/developers/api
   - Books responses carry this licence text: "Open Library data; no new rights asserted by the Internet Archive (see https://openlibrary.org/developers/licensing); some contributions may carry existing rights".
2. Run `npm ci` to install dependencies from the lockfile.
3. Run `npm run lint` to verify code style via ESLint.
4. Run `npm run typecheck`, `npm run build`, and `npm test` for the fast unit-test baseline.
5. Run `npm run test:emulator` to run integration tests against the local Firebase Authentication and Firestore Emulators using the synthetic `demo-littlesteps` project.
6. For interactive local development, run `npm run emulators -- --project demo-littlesteps`. Do not deploy to cloud environments during initial setup.

The Auth Emulator integration suite tests malformed/invalid tokens, emulator-issued ID tokens, and validates that the API derives the identity UID strictly from the verified token rather than client parameters.

> [!NOTE]
> Passing local tests verifies this local in-memory emulator path only. It does not prove deployed Firebase configuration, Firestore security rules, child ownership isolation, or production readiness.

---

## API Endpoints & Contract
The canonical interface specification is detailed in [`docs/api-reference.md`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/api-reference.md) and maintained locally in [`openapi/openapi.yaml`](openapi/openapi.yaml):

### Baseline Scaffold Endpoints:
- `GET /health` — public liveness health check.
- `GET /api/v1/me` — requires `Authorization: Bearer <Firebase ID token>` and returns the verified UID.

### Implemented Catalog Endpoints (public, cacheable):
- `GET /api/v1/catalog/activities` and `GET /api/v1/catalog/activities/{id}` — age-aware learning catalog (`public, max-age=3600`).
- `GET /api/v1/catalog/books` — Open Library proxy with bounded query validation, allowlisted subjects, server-side cache (`X-Cache`) and offline fallback.

All other routes, including errors, respond with `Cache-Control: no-store`.

### Implemented Child Profile Endpoints (authenticated):
- `POST /api/v1/children`, `GET /api/v1/children`, `GET`/`PATCH /api/v1/children/{childId}` — Child profile management with server-side UID ownership scoping (BOLA 404 `RESOURCE_NOT_FOUND` on unauthorized access). See Status below.

### Implemented AI Endpoint (authenticated):
- `POST /api/v1/ai/recommendations` — constrained activity suggestions from reviewed catalog items; deterministic catalog fallback only, no AI provider configured yet.

#### AI rate limiting
- Limits: 10 requests per signed-in user and 30 per IP address, each per clock hour (fixed window, UTC; a burst across an hour boundary can use up to twice the limit). Over the limit: `429 RATE_LIMITED`, `Retry-After` = seconds until the window resets (1 to 3600), `Cache-Control: no-store`.
- Every authenticated request counts, including ones rejected for invalid input, and the check runs before the provider call. Unauthenticated requests are rejected earlier and are not counted. The IP check runs first, so a blocked address does not write to Firestore.
- Per-user counters live in Firestore at `rate_limits/{uid}_{hourBucket}` and hold only `uid`, `bucket`, `count` and `expiresAt`, updated in a transaction. Enable a Firestore TTL policy on `rate_limits.expiresAt` (`gcloud firestore fields ttls update expiresAt --collection-group=rate_limits`) so old windows are deleted; this has not been applied to any project yet.
- Per-IP counters are in memory, per function instance, so that cap is best effort and resets on restart. The app trusts one proxy hop (`trust proxy` = 1): `req.ip` is the rightmost `X-Forwarded-For` entry, which the Google front end appends; earlier, client-supplied entries are ignored. This has not been checked on a deployed function. If the real proxy chain differs, the per-IP cap may group unrelated users or be bypassable.
- If a limiter store errors, the request is allowed (fail open) and only `{"event":"ai.rate_limit_unavailable"}` is logged, so an outage does not take suggestions down.
- Tests inject limiters with `setRateLimiter()` and `setIpRateLimiter()`; the Firestore limiter is covered by the emulator suite.

### Planned Feature & Integration Endpoints:
- `POST /api/v1/ai/story-activity` — Storybook activity generator with 3-tier fallback engine (Cloud Gemini $\to$ Local Ollama $\to$ Deterministic Catalog).

---

## Status & Pre-Feature Prerequisites

The child-profile routes (Issue #8) implement the contract in
[OpenAPI](openapi/openapi.yaml): create/list at `/api/v1/children` and read/update
at `/api/v1/children/{childId}`. See the [child-profile ownership contract](docs/child-profile-contract.md)
for field mappings, synthetic examples, review gates (age rules, field mapping and HTTP details decided; deletion and retention open) and privacy
decisions. Run `npm run test:emulator` to exercise them against the Auth and Firestore emulators.

Done for the children routes: Firestore schema and ownership model, server-side ownership checks, request validation with negative tests, emulator tests, and the OpenAPI contract.

Still to do:
- Child data export and deletion (D5), and retention (D6).
- Rate limiting is done for the AI endpoint; still to do: rate limiting for the other endpoints, other abuse protections, and budget alerts before enabling AI provider calls.
- Review Firebase billing plans, privacy obligations, and provider terms before deployment.

---

## Community & Contributing
- [Contributing Guidelines](CONTRIBUTING.md): Branch conventions, verification commands, and PR review rules.
- [Security Policy](SECURITY.md): Vulnerability reporting and responsible disclosure.
- [Code of Conduct](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/CODE_OF_CONDUCT.md): Shared expectations for respectful academic collaboration.

---

## Rights Notice — Wording Pending Review
**All Rights Reserved (Academic Evaluation Only)** is the project's intended rights policy. The repositories are public for academic course evaluation, faculty review, and demonstration; this notice does not technically restrict who can view or interact with public repositories. The wording and intended restrictions have not been represented as legally reviewed. Before relying on the notice as a formal legal instrument, seek review from the course instructor or an appropriate legal resource. No open-source license is intentionally granted by this project; do not interpret this notice as a reviewed license instrument.
