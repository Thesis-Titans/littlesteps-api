# LittleSteps API

Node.js + TypeScript API using Express hosted by Firebase Cloud Functions (2nd gen). Health, authenticated identity (`/me`), catalog and child-profile routes are implemented, with server-side ownership checks. AI recommendations (api PR #28), rate limiting and abuse protection, data export and deletion are not implemented yet.

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
- Implement rate limiting, abuse protections, and budget alerts before enabling AI provider calls.
- Review Firebase billing plans, privacy obligations, and provider terms before deployment.

---

## Community & Contributing
- [Contributing Guidelines](CONTRIBUTING.md): Branch conventions, verification commands, and PR review rules.
- [Security Policy](SECURITY.md): Vulnerability reporting and responsible disclosure.
- [Code of Conduct](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/CODE_OF_CONDUCT.md): Shared expectations for respectful academic collaboration.

---

## Rights Notice — Wording Pending Review
**All Rights Reserved (Academic Evaluation Only)** is the project's intended rights policy. The repositories are public for academic course evaluation, faculty review, and demonstration; this notice does not technically restrict who can view or interact with public repositories. The wording and intended restrictions have not been represented as legally reviewed. Before relying on the notice as a formal legal instrument, seek review from the course instructor or an appropriate legal resource. No open-source license is intentionally granted by this project; do not interpret this notice as a reviewed license instrument.
