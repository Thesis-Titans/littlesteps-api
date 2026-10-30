# Child profile and caregiver ownership contract

Status: **Proposed contract for review; not implemented.** Issue #7 defines the
interface. Issue #8 implements it after relevant decision gates are resolved.
Preparing this draft does not replace Mark's and the feature partner's review.

## Sources and conventions

- [Issue #7](https://github.com/Thesis-Titans/littlesteps-api/issues/7), including Mark's October 28, 2026 comment: `nickname`, `birthMonthYear`, derived `ageBand`, verified-UID ownership, identical 404 responses for missing/cross-owner IDs.
- [Parent feature #46](https://github.com/Thesis-Titans/littlesteps-docs/issues/46).
- [Canonical data model](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/data-model.md), sections 1, 2.2 and 3: caregiver-scoped storage, UUIDv4, fields and proposed lifecycle requirements.
- [Architecture ADR-003 through ADR-005](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/architecture-decisions.md): Firebase authentication, application-level ownership, Firestore and OpenAPI.
- [UI specification](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/ui-ux-design-specification.md), sections 2 and 4: month/year input, direct-band alternative, no surname/photo.
- [Security/privacy requirements](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/security-privacy-ai.md): NFR-SEC-01/02/04 and NFR-PRIV-01/03.

The authoritative interface is [OpenAPI](../openapi/openapi.yaml). Only
`GET /health` and `GET /api/v1/me` currently exist. Child paths, success
projections and new validation behavior below are proposals, not working routes.

## Minimum model and API/storage mapping

| API field | Internal field/type | Required in record | Constraints and rationale |
|---|---|---|---|
| `id` | `id`: string; document ID | Yes | Server-generated lowercase UUIDv4; stable lookup key, never proof of ownership. |
| `nickname` | `name`: string | Yes | 1-50 characters, not whitespace-only; supports child selection without requiring a full name. |
| `birthMonthYear` | `birthMonth`: string | No | `YYYY-MM`; coarse age calculation without a day of birth. Not in the future and at most 71 months old at create/edit (422 otherwise). |
| `ageBand` | `ageBand`: enum string | Yes | Navigation category. Derived on read from `birthMonth` when present (not trusted from storage); otherwise the stored caregiver-selected band. |
| Not exposed in draft | `caregiverId`: string | Yes | Server-assigned verified token UID; must equal parent caregiver path UID. Internal authorization field. |
| `createdAt` | Firestore timestamp | Yes | Server creation time; API serializes as UTC RFC 3339. Immutable. |
| `updatedAt` | Firestore timestamp | Yes | Server last-update time; API serializes as UTC RFC 3339. Never client-assigned. |

The proposed API/storage mapping reconciles the issue comment with the canonical
storage names without silently renaming stored fields. Mapping and omission of
the internal UID from responses need contract review. No duplicate personal-data
fields are proposed in storage.

No field accepts `null` in this draft. Optional birth information is omitted.
There are no implicit nickname, birth-month or age-band defaults. The server
assigns IDs, ownership and timestamps. Requests reject extra fields, including
`uid`, `caregiverId`, timestamps, surnames, photos and exact birth dates.
Schemas cannot determine whether free text names a real child: use only synthetic
data. Child names and birth information must not enter logs or AI prompts.

Create proposes a nickname plus exactly one age source: `birthMonthYear` or
`ageBand`. Both/neither fail validation. This avoids contradictory client input
when the server derives a band. Details remain subject to review.

Bands: `0-5m`, `6-11m`, `12-23m`, `24-35m`, `36-47m`, `48-59m`, `60-71m`.
These are educational navigation categories, not clinical classifications.
The candidate month calculation is
`12 * (currentYear - birthYear) + currentMonth - birthMonth`.
**Decided (D2):** age is computed from the server's UTC calendar month. The band
is derived on read from `birthMonth`, so it never goes stale. A birth month that
is in the future or more than 71 months ago (months = (current year × 12 + current month) − (birth year × 12 + birth month), in UTC; 0 to 71 inclusive is accepted) is rejected on create/edit with
`422 UNPROCESSABLE_ENTITY` (shape errors such as `2025-13` stay `400`). On read,
an existing child who has passed 71 months stays at `60-71m` (conservative
"outgrown" behaviour: never an error, no new field, no clamping on write).
A caregiver-selected band (no birth month) is returned as stored and does not age.
Examples use October 2026 explicitly. The OpenAPI pattern validates month shape only.

Nickname normalization (including trimming) is pending. The draft imposes raw
length bounds and rejects whitespace-only text. PATCH accepts `nickname`
and/or exactly one of `birthMonthYear` or `ageBand` (both fail with 400), with the
same validation as create, so caregivers can correct age (right to rectification,
data-model section on privacy). Sending `birthMonthYear` stores the month and the
band is derived on read; sending `ageBand` replaces the age source and removes any
stored birth month. Empty updates and nulls are invalid (400); an out-of-range
birth month is 422.

## Identity and ownership

Use `Authorization: Bearer <Firebase ID token>` and HTTPS outside local emulators.
Reuse `requireFirebaseUser`, which calls Admin SDK `verifyIdToken` and exposes
`request.firebaseUser.uid`. Body, URL, query or custom-header UIDs never replace
verified identity. No new revocation guarantee or authentication logic is added.
Missing, malformed, expired and invalid tokens return the same existing
`401 UNAUTHENTICATED` body without verification details.

Authenticate before ownership lookup. Existing Express JSON parsing and CORS run
before route middleware; malformed JSON/disallowed origins can therefore fail
before route authentication. This contract does not change that behavior.

Trusted path: `caregivers/{verifiedUid}/children/{childId}`.

| Operation | Required server boundary |
|---|---|
| Create | Generate ID, choose path from verified UID, set `caregiverId` to that UID. Never accept a client-chosen owner. |
| List | Query only the verified UID's children; check ownership before projection. Never scan another caregiver's children or filter in the client. |
| Read | Resolve ID within the verified UID's path; verify stored `caregiverId === verifiedUid` before disclosure. |
| Update | Same lookup/owner check before mutation. ID, ownership and creation timestamp remain immutable. |
| Cross-owner ID / substituted ID | No fallback global search. Same 404 as an absent record, no foreign metadata and no mutation. |
| Nonexistent child | Same 404. An absent URL segment is a route mismatch, not an absent UUID lookup. |

Path selection protects the initial lookup; stored ownership protects disclosure
and mutation. Owner/path mismatch fails closed with the same external 404 and
no private metadata in logs. UUID uniqueness is not authorization. Admin SDK
bypasses Firestore rules, so application checks are mandatory; existing deny-all
client rules stay intact. No sharing, delegation or ownership-transfer API exists.

## Proposed operations

| Method/path | Operation ID | Success | Documented failures |
|---|---|---|---|
| `POST /api/v1/children` | `createChild` | 201 profile | 400 input/JSON; 401 token; 422 age out of range |
| `GET /api/v1/children` | `listChildren` | 200 array, including `[]` | 401 token |
| `GET /api/v1/children/{childId}` | `getChild` | 200 profile | 400 UUID; 401 token; 404 missing/not owned |
| `PATCH /api/v1/children/{childId}` | `updateChild` | 200 updated profile | 400 input/JSON/UUID; 401 token; 404 missing/not owned; 422 age out of range |

Paths follow the existing `/api/v1` prefix but remain proposed. A profile object
or bare array avoids inventing a common success envelope; list ordering and
pagination are unspecified. Errors use the `ErrorEnvelope` schema, `{ "error": { "code", "message", "details"? } }`, where `details` is an optional array of `{ "field", "issue" }`.
Proposed `INVALID_INPUT` uses 400, matching the existing malformed-input status.
Generic 500 and CORS 403 remain as implemented in `src/app.ts`; ownership uses
404. Validation must not disclose whether another caregiver owns a valid UUID.

## Synthetic examples

These are illustrative contract exchanges, not observed HTTP results. Paths are
relative to the Functions API base URL. For examples 1-4 and 7-10, send
`Authorization: Bearer <emulator-token-for-caregiver-a>`. This placeholder must
be replaced by an emulator-issued token for synthetic caregiver A. JSON requests
also send `Content-Type: application/json`.

1. **Create:** `POST /api/v1/children` with
   `{"nickname":"Sample Child","birthMonthYear":"2025-08"}` proposes 201 with
   the profile below (reference month October 2026).

```json
{
  "id": "6f1c344e-84a8-4e24-9d72-74739a8c1362",
  "nickname": "Sample Child",
  "birthMonthYear": "2025-08",
  "ageBand": "12-23m",
  "createdAt": "2026-10-29T08:00:00Z",
  "updatedAt": "2026-10-29T08:00:00Z"
}
```

   Birth-free input is `{"nickname":"Sample Child","ageBand":"12-23m"}`;
   its response omits `birthMonthYear`.

2. **List:** `GET /api/v1/children` proposes 200 with `[<profile above>]`, or
   `[]` for no children. The actual valid JSON populated array is in OpenAPI's
   `listChildren` example; the angle-bracket notation here is illustrative.
3. **Read:** `GET /api/v1/children/6f1c344e-84a8-4e24-9d72-74739a8c1362`
   proposes 200 with the profile above, assuming it belongs to A.
4. **Update:** PATCH that same child path with `{"nickname":"Sample Sprout"}`.
   Proposed 200 retains ID, birth month, age band and `createdAt`, changes
   `nickname` to `Sample Sprout`, and sets server `updatedAt` to
   `2026-10-29T08:05:00Z`, as in OpenAPI's update example.
5. **Unauthenticated:** GET the list without Authorization returns 401:
   `{"error":{"code":"UNAUTHENTICATED","message":"A valid bearer token is required"}}`.
6. **Invalid/expired/malformed token:** GET the list with `Bearer invalid.token.value`,
   an expired synthetic token or malformed Bearer header has the same 401 body.
7. **Cross-owner:** Assume B owns `9f7df214-655e-48de-82a8-dde1486746bf`.
   A's GET at that child path returns 404:
   `{"error":{"code":"RESOURCE_NOT_FOUND","message":"Resource not found"}}`.
8. **Identifier substitution:** A replaces their PATCH URL ID with B's ID and
   sends `{"nickname":"Sample Sprout"}`: identical 404, no mutation. Forged UID
   headers/query parameters cannot change identity. A `caregiverId` body field
   fails validation with 400; it cannot assign an owner. There is no caregiver-UID
   path parameter in this draft.
9. **Validation:** POST with `{"nickname":"","birthMonthYear":"2025-13"}`
   proposes 400:
   `{"error":{"code":"INVALID_INPUT","message":"Request fields are invalid"}}`.
   Malformed JSON uses existing 400 `INVALID_JSON` / `Request body must be valid JSON`.
   Malformed UUID syntax uses proposed 400 `INVALID_INPUT`, not an ownership lookup.
10. **Age out of range:** POST `{"nickname":"Sample Child","birthMonthYear":"2027-01"}`
    (future) or `"2019-01"` (over 71 months) proposes 422:
    `{"error":{"code":"UNPROCESSABLE_ENTITY","message":"Child age must be between 0 and 71 months","details":[{"field":"birthMonthYear","issue":"Must not be in the future or older than 71 months"}]}}`.
    PATCH `{"birthMonthYear":"2025-07"}` corrects age with the same checks.
11. **Missing child:** Assume `8c2bce8d-9066-428d-aafa-c26761845c6e` is absent.
    A's GET or PATCH at that child path receives the identical 404 body from
    example 7, regardless of whether the ID exists elsewhere.

## Deletion, retention and review gates

The canonical data model describes hard cascade deletion of a child's milestone
observations, scheduled activities, journal entries and weekly summaries; account
deletion covers associated children and the caregiver document. These are proposed
lifecycle requirements, not implemented guarantees. No deletion endpoint, SLA,
database migration, owner transfer or multi-owner support is added.

| Gate | Question and effect | Status / reviewer |
|---|---|---|
| D1: Mapping/projection | Confirm API/storage mapping and omission of internal UID; affects client/schema alignment. | PENDING CONFIRMATION by Mark (nickname to `name`, `birthMonthYear` to `birthMonth` mapping; not decided here). |
| D2: Age calculation | UTC calendar month; band derived on read; 422 on create/edit beyond 71 months or future; existing child stays at `60-71m` on read. | DECIDED (this PR review); Mark may still review. |
| D3: Age edits | PATCH allows nickname and exactly one age source; switching replaces the source; no nulls/clearing; both sources is 400. | DECIDED (this PR review); Mark may still review. |
| D4: HTTP/input details | Confirm normalization, methods/paths, 400 code, success projection and bare-array list. | PENDING DECISION: contract reviewers. |
| D5: Deletion execution | Decide orchestration, partial failures, retries, account-deletion sequencing, concurrent writes and backups; prevents orphaned private records. | BLOCKED for deletion implementation: technical lead and responsible privacy authority. |
| D6: Production retention | Decide purpose, durations, exceptions, notice and deletion timing. Proposed 12-month inactivity rule is not approved. | BLOCKED for production policy/deployment: responsible school/team authority. |

Synthetic demo records are intended to reset with the emulator environment; no
durable retention/recoverability guarantee is made. Exported emulator files,
logs and backups require separate lifecycle review. Removing a Firebase Auth
login alone must not be claimed as complete account data deletion.

## Verification boundary

Validate OpenAPI syntax, references and examples, and run canonical docs checks.
The API currently has no dedicated OpenAPI validation script. Temporary tooling
must not change project dependencies merely to check the draft. Schema validation
cannot establish working endpoints, authentication, ownership, age calculations,
cascades or production readiness. Issue #8 requires positive/negative emulator
tests for each operation, token failures, invalid input, cross-owner reads/writes,
forged owner fields and substituted IDs after the relevant gates are resolved.
