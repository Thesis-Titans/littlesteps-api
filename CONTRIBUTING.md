# Contributing to LittleSteps API

This repository contains the backend REST services for LittleSteps, implemented with Node.js and TypeScript on Express and hosted on Firebase Cloud Functions (2nd gen).

For overall project governance, three-tier architecture, code of conduct, and shared standards, refer to the [canonical Contributing Guidelines in `littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/CONTRIBUTING.md).

---

## Prerequisites and environment

- **Node.js:** 22 LTS
- **npm:** 10+
- **Java JDK:** 21 LTS (required by the Firebase Emulator Suite)
- **Firebase CLI:** 14+ (`npm install -g firebase-tools` or run via `npx`)

Follow the reproducible full-stack setup guide in the [Developer Onboarding Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/getting-started.md).

---

## Local verification commands

Execute the full verification suite locally before creating a pull request:

```bash
# 1. Install exact dependencies from lockfile
npm ci

# 2. Run ESLint code quality checks
npm run lint

# 3. Typecheck TypeScript sources without emitting files
npm run typecheck

# 4. Compile TypeScript bundle
npm run build

# 5. Run unit and route test suites
npm test

# 6. Run Auth and Firestore Emulator integration suite
npm run test:emulator
```

All lint errors, typecheck warnings, and failing tests must be resolved before requesting review.

---

## Pull request and branching workflow

- **Branch naming:** Create focused topic branches off an up-to-date `main`:
  - `feat/<feature-name>`: New routes, stores, or service features.
  - `fix/<bug-description>`: Bug fixes or security patches.
  - `docs/<topic>`: Documentation, contracts, or OpenAPI specification updates.
  - `chore/<task>`: Tooling updates, dependency bumps, or script improvements.
- **Pull request requirements:** All changes merge into `main` via pull requests. Direct pushes to `main` are disabled.
- **Required CI checks:** Every pull request must pass the automated GitHub Actions **`API CI/verify`** workflow (lint, typecheck, build, unit tests, and emulator integration tests).
- **Peer review:** Every pull request requires review from at least one teammate. Pull requests modifying data schemas, authentication middleware, security rules, or AI prompt logic require an additional review from Mark.
- **Individual commits:** Each team member must author and commit from their own Git identity to maintain individual contribution records for academic evaluation.

---

## Technical standards and rules

### Synthetic data and emulator isolation
- **No real data:** Never test against real user accounts, real child information, or production credentials.
- **Emulator isolation:** Integration tests run against the local Firebase Emulator Suite (`demo-littlesteps`). Test fixtures and tokens are synthetic throwaways.

### Server-side authorization and BOLA prevention
- Never trust client-supplied UIDs in request bodies or query parameters.
- Verify Firebase ID tokens server-side using the Firebase Admin SDK and derive identity solely from `req.user.uid`.
- Verify server-side ownership before returning, updating, or deleting any child-scoped record. Return `404 RESOURCE_NOT_FOUND` on ownership mismatches to prevent account enumeration.

### OpenAPI specification synchronization
- The API repository maintains the technical contract at [`openapi/openapi.yaml`](openapi/openapi.yaml).
- Any route modification, request/response schema change, parameter addition, or error code update must include the matching update to `openapi/openapi.yaml` in the same pull request.

### Error response consistency
All routes must return standardized error JSON envelopes matching the API specification:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Human-readable error explanation."
  }
}
```

Standard error codes: `RESOURCE_NOT_FOUND`, `INVALID_INPUT`, `UNAUTHENTICATED`, `UNPROCESSABLE_ENTITY`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`.

---

## Security, privacy, and credentials

- **Credential isolation:** Never commit service account credentials, cloud keys, or `.env` files.
- **Data minimization:** Never include child names, dates of birth, or private journal entries in AI prompts or server logs.
- **Vulnerability reporting:** Report any security vulnerabilities following [`SECURITY.md`](SECURITY.md).

---

## Rights policy

All Rights Reserved (Academic Evaluation Only). Public repository visibility does not grant an open-source redistribution license.
