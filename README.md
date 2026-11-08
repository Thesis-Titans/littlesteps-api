# LittleSteps API

Node.js and TypeScript backend service for **LittleSteps**, implemented with Express and deployed to Firebase Cloud Functions (2nd gen).

The service provides REST endpoints for caregiver authentication, child profiles, routine play planning, private observational journaling, milestone tracking, weekly summaries, an age-aware learning catalog with Open Library book integration, and constrained AI play suggestions with a 3-tier fallback engine.

---

## Canonical project documentation

System architecture, product scope, data models, and privacy policies are maintained centrally in [`littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs):

- [Developer Onboarding Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/getting-started.md): Full-stack local setup instructions across repositories.
- [API Reference and Integration Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/api-reference.md): Canonical interface specification, Open Library proxy, 3-tier AI fallback engine, and error schemas.
- [Product Scope](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/product-scope.md): Functional requirements (FR-01 through FR-07) and non-diagnostic boundaries.
- [Architecture Decisions](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/architecture-decisions.md): Architecture decision records (ADR-001 through ADR-010).
- [Data Model Specification](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/data-model.md): Firestore collections, subcollections, composite indexes, and field constraints.
- [Security, Privacy, and AI Guardrails](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/security-privacy-ai.md): Philippine Data Privacy Act of 2012 (RA 10173) compliance, BOLA prevention, and AI data safeguards.
- [Documentation Standards](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/documentation-standards.md): Documentation hierarchy and repository consistency guidelines.

---

## Requirements and prerequisites

- **Node.js:** 22 LTS
- **npm:** 10+
- **Java JDK:** 21 LTS (required for the Firebase Emulator Suite)
- **Firebase CLI:** 14+ (`npm install -g firebase-tools` or run via `npx`)

---

## Local setup and verification

```bash
# 1. Clone repository and navigate to api directory
cd littlesteps-api

# 2. Copy environment template
cp .env.example .env

# 3. Install exact dependencies from lockfile
npm ci

# 4. Verify code quality with ESLint
npm run lint

# 5. Typecheck TypeScript sources
npm run typecheck

# 6. Build JavaScript bundle
npm run build

# 7. Run unit test suite (388 passing tests across 17 test suites)
npm test

# 8. Run Firebase Emulator integration suite (Auth & Firestore)
npm run test:emulator
```

For interactive local testing with web and mobile clients:

```bash
# Start local Firebase Emulators (Functions, Auth, Firestore)
npm run emulators -- --project demo-littlesteps
```

> [!NOTE]
> Passing local tests verifies the local in-memory emulator path. Cloud deployment requires verified Firebase billing, Firestore security rules deployment, and configured runtime secrets.

---

## API endpoints and interface contract

The technical contract is specified in [`openapi/openapi.yaml`](openapi/openapi.yaml) and documented in [`docs/api-reference.md`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/api-reference.md).

All authenticated routes require a Firebase ID token sent in the `Authorization: Bearer <token>` header. Identity (`req.user.uid`) is derived exclusively from server-side token verification.

### Health and caregiver account
- `GET /health` — Public liveness health check probe.
- `GET /api/v1/me` — Returns the authenticated caregiver's verified UID.
- `GET /api/v1/me/export` — Exports caregiver profile, child records, plans, observations, and journal entries as JSON (RA 10173 data portability).
- `DELETE /api/v1/me` — Permanently deletes caregiver profile, child subcollections, and Firebase Auth account (RA 10173 right to erasure).

### Learning catalog and external integrations (public, cacheable)
- `GET /api/v1/catalog/activities` — Age-aware activity catalog (`Cache-Control: public, max-age=3600`).
- `GET /api/v1/catalog/activities/{id}` — Single catalog activity details.
- `GET /api/v1/catalog/books` — Open Library picture books proxy with bounded subject validation, local cache (`X-Cache`), and offline fallback.
- `GET /api/v1/catalog/weather-hint` — Weather-adaptive play recommendations based on local climate conditions.

### Child profile management (FR-01)
- `GET /api/v1/children` — List children registered to the authenticated caregiver.
- `POST /api/v1/children` — Register a child profile (birth date, sex, optional nickname).
- `GET /api/v1/children/{childId}` — Retrieve child profile by ID.
- `PATCH /api/v1/children/{childId}` — Update child profile fields.
- `DELETE /api/v1/children/{childId}` — Hard cascade deletion of child document and nested subcollections.

### Routine play planning (FR-02)
- `GET /api/v1/children/{childId}/plans` — List scheduled activity plans (filterable by date and completion status).
- `POST /api/v1/children/{childId}/plans` — Schedule an activity for a child.
- `PATCH /api/v1/children/{childId}/plans/{planId}` — Update plan details or toggle completion status.
- `DELETE /api/v1/children/{childId}/plans/{planId}` — Remove scheduled activity plan.

### Private observation journal (FR-03)
- `GET /api/v1/children/{childId}/journal` — List caregiver observation journal entries (reverse-chronological, filterable by date).
- `POST /api/v1/children/{childId}/journal` — Create private observation journal entry.
- `GET /api/v1/children/{childId}/journal/{entryId}` — Retrieve single journal entry.
- `PATCH /api/v1/children/{childId}/journal/{entryId}` — Update journal entry content or linked milestones.
- `DELETE /api/v1/children/{childId}/journal/{entryId}` — Permanently delete journal entry.

### Milestone observation tracking (FR-04)
- `GET /api/v1/children/{childId}/milestones` — List developmental milestone observations for a child.
- `POST /api/v1/children/{childId}/milestones` — Record milestone observation status (`observed`, `emerging`, `not_yet`).
- `DELETE /api/v1/children/{childId}/milestones/{milestoneRecordId}` — Delete milestone observation record.

### Weekly reflection summary (FR-05)
- `GET /api/v1/children/{childId}/summary/weekly` — Aggregate completed plans and milestone observations over a 7-day window.

### Constrained AI play helpers (FR-07)
- `POST /api/v1/ai/recommendations` — Play suggestions selected from reviewed catalog items using age band, available time, materials, and environment.
- `POST /api/v1/ai/story-activity` — Play idea generator based on picture book themes, materials, and caregiver preferences.

Both AI routes execute with the 3-tier fallback engine: Cloud Gemini $\to$ Local Edge Ollama $\to$ Deterministic Catalog Matcher.

---

## Architecture and directory layout

```text
littlesteps-api/
├── openapi/
│   └── openapi.yaml           # Canonical OpenAPI 3.1.0 specification
├── src/
│   ├── account/               # Identity, export, and account deletion
│   ├── activities/            # Routine play planning routes and store
│   ├── ai/                    # AI helpers, Gemini provider, and fallback engine
│   ├── catalog/               # Activity catalog, Open Library proxy, weather hint
│   ├── children/              # Child profile management and age calculation
│   ├── journal/               # Private observation journal routes and store
│   ├── middleware/            # Firebase Auth Bearer token verification
│   ├── milestones/            # Milestone observation routes and store
│   ├── summary/               # Weekly reflection summary aggregation
│   ├── app.ts                 # Express application configuration and middleware
│   └── index.ts               # Cloud Functions export entrypoint
├── test/                      # Unit, integration, and security regression test suites
├── docs/                      # Technical contracts and security audit records
├── firestore.indexes.json     # Firestore composite index definitions
├── firestore.rules            # Firestore security rules
└── package.json
```

---

## AI provider and safety guardrails

### Provider configuration
- **Required environment variables:** `GEMINI_API_KEY` and `GEMINI_MODEL` (e.g., `gemini-2.5-flash`).
- When variables are unset or the provider times out (8-second abort signal), the engine automatically falls back to deterministic catalog matching with HTTP 200.
- Circuit breaker trips after 3 consecutive external provider failures, routing requests directly to the fallback engine for 60 seconds.

### Rate limiting
- **Per-caregiver limit:** 10 requests per clock hour, enforced via transactional atomic counters in Firestore (`rate_limits/{uid}_{hourBucket}`).
- **Per-IP limit:** 30 requests per clock hour in-memory via trusted proxy headers (`AI_IP_LIMIT_PER_HOUR`).
- Exceeded limits return `429 RATE_LIMITED` with a `Retry-After` header.

### Child data privacy (RA 10173 and NFR-PRIV-02)
- Prompts sent to external AI providers contain strictly synthetic or anonymized developmental parameters: age band (e.g. `12-23m`), available time, setting, language preference, and candidate activity titles.
- Child names, birth dates, and journal notes are strictly excluded from AI prompts and telemetry logs.

---

## Firestore composite indexes

Deploy composite indexes before running queries that filter and sort on subcollections:

```bash
firebase deploy --only firestore:indexes
```

Defined indexes in `firestore.indexes.json`:
- `plans`: `(status ASC, scheduledDate ASC/DESC)`
- `milestone_observations`: `(status ASC, observedDate ASC/DESC)`, `(milestoneId ASC, observedDate ASC/DESC)`
- `journal_entries`: `(entryDate DESC, createdAt DESC)`

---

## Contributing and security

- [Contributing Guidelines](CONTRIBUTING.md): Branching conventions, local test steps, and review standards.
- [Security Policy](SECURITY.md): Vulnerability reporting procedures, BOLA prevention, and privacy boundaries.
- [Code of Conduct](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/CODE_OF_CONDUCT.md): Team collaboration expectations.

---

## Rights notice

All Rights Reserved (Academic Evaluation Only). This repository is published publicly for academic evaluation and faculty review at West Visayas State University. No open-source redistribution license is granted.
