# M5 Pre-Deployment Security, Authorization Regression, and Environment Readiness Review

**Issue:** `Thesis-Titans/littlesteps-api#14`  
**Governing Baseline:** [`docs/security-privacy-ai.md`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/security-privacy-ai.md) (ISO/IEC/IEEE 29148:2018 & RA 10173)  
**Scope:** M1–M4 API endpoints, cross-feature authorization matrix, error envelope hygiene, rate limits, AI budget guardrails, and Firebase cloud pre-deployment controls.

---

## 1. Automated Regression Suite Verification

All local verification gates must pass cleanly prior to any release demonstration or cloud deployment:

| Verification Gate | Command | Scope | Status |
| :--- | :--- | :--- | :--- |
| Static Lint | `npm run lint` | ESLint across `src/**/*.ts` and `test/**/*.ts` | Verified |
| Type Safety | `npm run typecheck` | TypeScript strict compiler check (`tsc --noEmit`) | Verified |
| Build Output | `npm run build` | Production CommonJS/ESM compilation to `lib/` | Verified |
| Unit & Security Regression Suite | `npm test` | App scaffold, CORS, body limits, catalog, children, plans, milestones, account export/deletion, AI provider/fallback/rate-limit, and cross-feature authorization matrix (`test/security-regression.test.ts`) | Verified |
| Emulator Integration Suite | `npm run test:emulator` | Live Firebase Auth Emulator + Firestore Emulator verification (`auth-emulator`, `children-emulator`, `plans-milestones-emulator`) | Verified |

---

## 2. Cross-Feature Authorization Matrix (`NFR-SEC-01`, `NFR-SEC-02`)

Every authenticated endpoint verifies the `Authorization: Bearer <Firebase ID token>` header via `requireFirebaseUser` (`getAuth().verifyIdToken()`). Trusted identity is derived exclusively from `request.firebaseUser.uid`.

All child-scoped endpoints verify child ownership (`child.caregiverId === verifiedUid`) on the server before any Firestore read, write, or delete. Cross-owner requests, nonexistent UUIDs, and malformed UUIDs return an identical `404 RESOURCE_NOT_FOUND` envelope (`{ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } }`) to prevent resource-existence enumeration.

| Endpoint | Auth Required | Ownership Enforcement | Unauthenticated Response | Cross-Owner / Foreign `childId` Response | Forged `caregiverId` / `uid` in Body |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /health` | Public | None (liveness only) | `200 OK` | N/A | N/A |
| `GET /api/v1/catalog/activities` | Public | Approved / opt-in fixture catalog only | `200 OK` | N/A | N/A |
| `GET /api/v1/catalog/activities/:id` | Public | Approved / opt-in fixture catalog only | `200 OK` / `404` | N/A | N/A |
| `GET /api/v1/catalog/books` | Public | Allowlisted subjects & bounded query | `200 OK` / `400` | N/A | N/A |
| `GET /api/v1/me` | Bearer token | `request.firebaseUser.uid` only (ignores query/body `uid`) | `401 UNAUTHENTICATED` | Caller's own UID only | Ignored |
| `GET /api/v1/me/export` | Bearer token | Exports only `caregivers/{uid}` and children where `caregiverId === uid` | `401 UNAUTHENTICATED` | Foreign records excluded | N/A |
| `DELETE /api/v1/me` | Bearer token | Deletes only `caregivers/{uid}`, owned children/subcollections, and Auth user `uid` | `401 UNAUTHENTICATED` | Foreign records untouched | N/A |
| `GET /api/v1/children` | Bearer token | Scoped to `caregivers/{uid}/children` (`caregiverId === uid`) | `401 UNAUTHENTICATED` | Foreign children excluded | N/A |
| `POST /api/v1/children` | Bearer token | Writes under `caregivers/{uid}/children` with `caregiverId = uid` | `401 UNAUTHENTICATED` | N/A | `400 INVALID_INPUT` (`.strict()`) |
| `GET /api/v1/children/:childId` | Bearer token | Verifies `child.caregiverId === uid` | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | N/A |
| `PATCH /api/v1/children/:childId` | Bearer token | Transaction verifies `child.caregiverId === uid` | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | `400 INVALID_INPUT` (`.strict()`) |
| `DELETE /api/v1/children/:childId` | Bearer token | Verifies `child.caregiverId === uid` before cascade delete | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | N/A |
| `GET /api/v1/children/:childId/plans` | Bearer token | Verifies parent child ownership (`caregiverId === uid`) first | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | N/A |
| `POST /api/v1/children/:childId/plans` | Bearer token | Verifies parent child ownership (`caregiverId === uid`) first | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | `400 INVALID_INPUT` (`.strict()`) |
| `PATCH /api/v1/children/:childId/plans/:planId` | Bearer token | Verifies parent child + plan `caregiverId === uid` and `childId` | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | `400 INVALID_INPUT` (`.strict()`) |
| `DELETE /api/v1/children/:childId/plans/:planId` | Bearer token | Verifies parent child + plan `caregiverId === uid` and `childId` | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | N/A |
| `GET /api/v1/children/:childId/milestones` | Bearer token | Verifies parent child ownership (`caregiverId === uid`) first | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | N/A |
| `POST /api/v1/children/:childId/milestones` | Bearer token | Verifies parent child ownership (`caregiverId === uid`) first | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | `400 INVALID_INPUT` (`.strict()`) |
| `PATCH /api/v1/children/:childId/milestones/:milestoneId` | Bearer token | Verifies parent child + milestone `caregiverId === uid` | `401 UNAUTHENTICATED` | `404 RESOURCE_NOT_FOUND` | `400 INVALID_INPUT` (`.strict()`) |
| `POST /api/v1/ai/recommendations` | Bearer token | Per-UID (`10/hr`) & per-IP (`30/hr`) rate limit; zero child/caregiver PII accepted | `401 UNAUTHENTICATED` | N/A | `400 INVALID_INPUT` (`.strict()`) |

---

## 3. Error Envelope & Log Hygiene Audit (`NFR-SEC-04`, `NFR-PRIV-02`)

All error responses return a standardized `{ error: { code, message, details? } }` JSON envelope with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `X-Powered-By` disabled:

| HTTP Status | Error Code | Trigger | Information Protection Guarantee |
| :--- | :--- | :--- | :--- |
| `400` | `INVALID_JSON` | Malformed JSON request payload | Fixed message (`Request body must be valid JSON`); raw body is never echoed. |
| `400` | `INVALID_INPUT` | Zod schema validation failure | Field path and static validation issue only; rejected input values (such as notes) are never echoed. |
| `401` | `UNAUTHENTICATED` | Missing, malformed, expired, or invalid Bearer token | Fixed message (`A valid bearer token is required`); Firebase Auth error details and tokens are never returned or logged. |
| `403` | `ORIGIN_NOT_ALLOWED` | Request `Origin` header not in `CORS_ORIGINS` allowlist | Fixed message (`Origin is not allowed`); wildcard (`*`) origins are never emitted. |
| `404` | `RESOURCE_NOT_FOUND` | Unknown route, missing ID, malformed UUID, or cross-owner ID | Fixed message (`Resource not found`); identical across nonexistent and cross-owner resources. |
| `413` | `PAYLOAD_TOO_LARGE` | Request body exceeds `100kb` | Fixed message (`The request body is too large.`). |
| `422` | `UNPROCESSABLE_ENTITY` | Milestone `observedDate` more than UTC+14 today | Static field issue (`Must not be in the future`); private notes are never echoed or logged. |
| `429` | `RATE_LIMITED` | AI recommendations exceed 10/hr per UID or 30/hr per IP | Includes `Retry-After` (`1`–`3600` seconds); blocks before calling the AI provider. |
| `500` | `INTERNAL_ERROR` | Unhandled runtime or store exception | Fixed message (`An unexpected error occurred`); stack traces, internal file paths, tokens, and journal/observation texts are stripped. |
| `503` | `SERVICE_UNAVAILABLE` | Firestore transaction contention (`ABORTED`) or Auth deletion failure | Includes `Retry-After: 1` where applicable; internal error objects are never serialized to clients or logs. |

---

## 4. Environment Configuration & Secret Isolation Audit (`NFR-SEC-03`)

| Variable | Default (Unset) | Production / Cloud Requirement | Security Notes |
| :--- | :--- | :--- | :--- |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Set explicitly to verified HTTPS frontend origin(s) | Wildcard `*` is prohibited (`NFR-SEC-04`). |
| `SERVE_SYNTHETIC_CATALOG` | Unset (`false`) | Must remain unset/`false` in production | Only set to `true` in local/demo environments until Docs Issue #3 curriculum review completes. |
| `GEMINI_API_KEY` | Unset (AI provider disabled) | Inject via Firebase Secret Manager (`firebase functions:secrets:set GEMINI_API_KEY`) | Never commit to Git or expose to client bundles; sent only in server-side `x-goog-api-key` header. |
| `GEMINI_MODEL` | Unset (AI provider disabled) | Explicit supported model ID (e.g., `gemini-2.5-flash`) | If either `GEMINI_API_KEY` or `GEMINI_MODEL` is unset, `POST /api/v1/ai/recommendations` safely serves the Tier 3 deterministic catalog fallback. |
| `TRUST_PROXY_HOPS` | `1` | Verify hop count on deployed Cloud Function before relying on IP cap | Uses rightmost `X-Forwarded-For` entry appended by Google frontend proxy. |
| `AI_IP_LIMIT_PER_HOUR` | `30` | `30` (or `0` to disable IP cap while keeping 10/hr per-UID Firestore cap) | Protects against shared-IP bursts and uncached abuse. |
| `OPEN_LIBRARY_CONTACT` | Unset | Set team contact email for Open Library `User-Agent` | Polite API identification per Open Library guidelines. |

---

## 5. Firebase Billing, Budget Alerts, and Pre-Deployment Checklist (`security-privacy-ai.md` §6)

Before any cloud deployment (`firebase deploy`), complete and record sign-off on the following operational controls:

- [ ] **1. Firebase Billing & Budget Alerts (`NFR-REL-01`, §6.1):**
  - Configure Google Cloud / Firebase Billing budget alerts on the target project with a threshold of **$\le \$5.00$/month** and email notifications at `50%`, `90%`, and `100%` of budget.
  - Keep local development and CI strictly on the Firebase Emulator Suite (`demo-littlesteps`).
- [ ] **2. Firestore Security Rules Deployment (§6.2):**
  - Deploy `firestore.rules` (`allow read, write: if false;` across `/{document=**}`) so direct client-SDK reads/writes are blocked and all data access flows through the authenticated Admin SDK API.
- [ ] **3. Firestore TTL Policy for Rate Limit Counters (`NFR-REL-01`):**
  - Enable automatic TTL cleanup on `rate_limits.expiresAt` so expired hourly rate-limit buckets are purged automatically:
    ```bash
    gcloud firestore fields ttls update expiresAt --collection-group=rate_limits --project=<PROJECT_ID>
    ```
- [ ] **4. CORS Origin Allowlist (§6.3):**
  - Set `CORS_ORIGINS` to the exact production HTTPS web origin(s) and remove `localhost` origins in production environment configuration.
- [ ] **5. Privacy Notice & Data Subject Rights (§6.4, `NFR-PRIV-01`, `NFR-PRIV-04`):**
  - Caregiver data export (`GET /api/v1/me/export`), child cascade deletion (`DELETE /api/v1/children/:childId`), and full account deletion (`DELETE /api/v1/me`) are implemented and verified against the Auth and Firestore emulators.
- [ ] **6. AI Provider Terms, Budget & Data Guardrails (§6.5, `ADR-008`, `NFR-AI-02..04`):**
  - Per-user (`10/hr`) and per-IP (`30/hr`) rate limits, 8-second request timeout, 64KB response cap, and 3-failure/60-second circuit breaker are active on `POST /api/v1/ai/recommendations`.
  - Prompts strip all PII and include only coarse `ageBand`, `timeMinutes`, `setting`, sanitized `materials`, `language`, and catalog candidate IDs/titles.
  - Per `ADR-008`, the Gemini API free tier is restricted to **synthetic data only** for course evaluation; transition to a paid tier or Vertex AI with zero-training data retention terms before onboarding real caregiver data.

