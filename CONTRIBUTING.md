# Contributing to LittleSteps API

This repository contains the Node.js + TypeScript backend services for LittleSteps, implemented with Express and hosted on Firebase Cloud Functions (2nd gen).

For general project governance, three-tier architecture, code of conduct, and shared standards, refer to the [canonical Contributing Guidelines in `littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/CONTRIBUTING.md).

---

## 1. Prerequisites

- **Node.js 22 LTS**
- **npm 10+**
- **Java 21** (required by the Firebase Emulator Suite)
- **Firebase CLI** (`npm install -g firebase-tools` or via npx)

Follow the full reproducible setup guide in the [Developer Onboarding Guide](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/docs/getting-started.md).

---

## 2. Local Verification Commands

Run the full local verification suite before committing or opening a pull request:

```bash
# 1. Install exact dependencies from lockfile
npm ci

# 2. Run ESLint
npm run lint

# 3. Typecheck TypeScript sources
npm run typecheck

# 4. Build output bundle
npm run build

# 5. Run fast unit test baseline
npm test

# 6. Run Auth Emulator integration suite
npm run test:emulator
```

---

## 3. Pull Request & CI Expectations

- **Branching:** Work on focused topic branches (`feat/`, `fix/`, `docs/`, `chore/`). Never push directly to `main`.
- **Required CI Check:** The GitHub Actions workflow enforces **`API CI/verify`**, which executes linting, typechecking, building, unit tests, and emulator integration tests.
- **Review Governance:** During the initial setup phase, Mark Alvin Cadangin serves as the required human review and approval boundary before any PR may be merged into `main`.

---

## 4. API-Specific Technical Rules

### 4.1 Synthetic Data & In-Memory Emulators
- **No Real Data:** Never test against real production user accounts, child records, or cloud credentials.
- **Emulator Isolation:** Test suites (such as `test/auth-emulator.test.ts`) use mock keys (`fake-api-key`) and local test passwords (`LocalTestPassword123!`). These values are strictly synthetic inputs for the ephemeral in-memory Firebase Auth Emulator and must never be used in deployed environments.

### 4.2 Server-Side Authorization
- Never trust a client-supplied UID in request bodies or query parameters.
- Authenticated endpoints must verify the Firebase ID token using the Firebase Admin SDK and derive identity solely from the verified token UID.
- Child-scoped endpoints must verify server-side that the authenticated UID is authorized to access the requested child record.

### 4.3 OpenAPI Contract Synchronization
- The API repository maintains the technical contract at [`openapi/openapi.yaml`](openapi/openapi.yaml).
- Any endpoint modification, parameter change, error status change, or schema addition must include a corresponding update to `openapi/openapi.yaml` in the same pull request.

---

## 5. Security & Rights

- **Vulnerability Reporting:** Never report vulnerabilities in public issues. Follow [`SECURITY.md`](SECURITY.md) or the canonical [Security Policy in `littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/SECURITY.md).
- **Rights Policy:** The project's intended rights policy is **All Rights Reserved (Academic Evaluation Only)**. Public visibility does not grant an open-source redistribution license.
