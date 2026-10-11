# LittleSteps API

Node.js + TypeScript API using Express hosted by Firebase Cloud Functions (2nd gen). The initial scaffold provides health and authenticated identity endpoints only; feature endpoints and Firestore ownership checks are not implemented yet.

## Requirements
- Node.js 22
- npm
- Java 21 for Firebase Emulator Suite workflows

## Local setup
1. Copy .env.example to .env and set comma-separated CORS_ORIGINS for local web origins. Do not commit secrets.
2. Run `npm ci` to install dependencies from the lockfile.
3. Run `npm run typecheck`, `npm run build`, and `npm test` for the fast unit-test baseline.
4. Run `npm run test:emulator` to start a local Firebase Authentication Emulator and exercise token verification with synthetic identities. This uses the local demo project ID `demo-littlesteps`; it does not connect to a production Firebase project.
5. For interactive local development, configure the intended emulator project and run `npm run emulators`. Do not deploy as part of initial setup.

The Auth Emulator integration suite checks malformed and invalid tokens, a valid emulator-issued ID token, and that the API derives the returned UID from the verified token rather than a client-supplied query value. It requires the Auth Emulator host environment variable; the documented script and CI set it explicitly.

Passing these tests verifies this local/emulator path only. It does not prove deployed Firebase configuration, Firestore rules, child ownership security, or production readiness.

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
