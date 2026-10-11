# LittleSteps API

Node.js + TypeScript API using Express hosted by Firebase Cloud Functions (2nd gen). The initial scaffold provides health and authenticated identity endpoints only; feature endpoints and Firestore ownership checks are not implemented yet.

## Requirements
- Node.js 22
- npm
- Firebase CLI for emulator workflows

## Local setup
1. Copy .env.example to .env and set comma-separated CORS_ORIGINS for local web origins. Do not commit secrets.
2. Run `npm ci` to install dependencies from the lockfile.
3. Run `npm run typecheck` and `npm test`.
4. For emulator integration, configure a Firebase project alias locally and run npm run emulators. Do not deploy as part of initial setup.

Current tests are scaffold-level tests; they do not prove deployed Firebase Auth, Firestore rules, or child ownership security.

## Endpoints
- GET /health — public liveness response.
- GET /api/v1/me — requires Authorization: Bearer <Firebase ID token> and returns the verified UID.

## Required before feature work
- Define the Firestore schema and ownership model.
- Add server-side ownership authorization for every child-scoped operation.
- Add request schema validation and error tests.
- Complete OpenAPI contract and implement endpoints against it.
- Add rate limiting and AI provider controls before activating AI.
- Review Firebase billing, budget alerts, privacy notice, retention/deletion, and provider terms before deployment.