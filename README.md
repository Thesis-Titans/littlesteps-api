# LittleSteps API

Node.js + TypeScript API using Express hosted by Firebase Cloud Functions (2nd gen). The initial scaffold provides health and authenticated identity endpoints only; product feature endpoints and Firestore ownership checks are not implemented yet.

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
2. Run `npm ci` to install dependencies from the lockfile.
3. Run `npm run lint` to verify code style via ESLint.
4. Run `npm run typecheck`, `npm run build`, and `npm test` for the fast unit-test baseline.
5. Run `npm run test:emulator` to run integration tests against the local Firebase Authentication Emulator using the synthetic `demo-littlesteps` project.
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

### Planned Feature & Integration Endpoints (Sprint 1):
- `POST /api/v1/children`, `GET /api/v1/children`, `GET`/`PATCH /api/v1/children/{childId}` — Child profile management with server-side UID ownership scoping (BOLA 404 `RESOURCE_NOT_FOUND` on unauthorized access). Design-only contract, see Status below.
- `POST /api/v1/ai/story-activity` — Storybook activity generator with 3-tier fallback engine (Cloud Gemini $\to$ Local Ollama $\to$ Deterministic Catalog).

---

## Status & Pre-Feature Prerequisites

Issue #7 defines a **proposed, unimplemented** child-profile contract in
[OpenAPI](openapi/openapi.yaml): create/list at `/api/v1/children` and read/update
at `/api/v1/children/{childId}`. See the [child-profile ownership contract](docs/child-profile-contract.md)
for field mappings, synthetic examples, review gates (age rules decided; D1 mapping pending Mark) and privacy
decisions. These routes are not available in the emulator yet; implementation
belongs to Issue #8 after contract review.

The following milestones must be completed before implementing feature endpoints:
- Define the Firestore data schema and child ownership model.
- Implement server-side ownership authorization for every child-scoped operation.
- Implement request schema validation and negative error tests.
- Expand OpenAPI contract and validate implementations against it.
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
