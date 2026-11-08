# Security policy — LittleSteps API

This repository contains the backend REST services for LittleSteps, implemented with Node.js, Express, and Firebase Cloud Functions (2nd gen).

For overall system privacy, child data safeguards, and security policies, refer to the [canonical Security Policy in `littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/SECURITY.md).

---

## Supported versions

Only the latest commit on the `main` branch of `littlesteps-api` is actively maintained and evaluated for security:

| Branch | Status |
| :--- | :---: |
| `main` | Supported |
| All other branches and forks | Not supported |

---

## Reporting a vulnerability

> [!IMPORTANT]
> Do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Please report vulnerabilities privately through either channel:

1. **GitHub Private Vulnerability Reporting (preferred):**  
   Navigate to the **Security** tab of this repository and select **Report a vulnerability** to open a private advisory draft.
2. **Direct email:**  
   Contact project maintainer **Mark Alvin Cadangin** at [markcadangin@gmail.com](mailto:markcadangin@gmail.com) with the subject prefix `[SECURITY] LittleSteps API: <Brief Description>`.

---

## API security boundaries and threat model

### Broken Object Level Authorization (BOLA)
- Every child-scoped endpoint (`/api/v1/children/:childId/*`) validates that the requesting caregiver (`req.user.uid`) owns the target child record in Firestore before returning or mutating data.
- Unauthorized attempts to access child records owned by another caregiver return `404 RESOURCE_NOT_FOUND` to prevent identity enumeration.

### Token verification
- Client requests must include a valid Firebase ID token in the `Authorization: Bearer <token>` header.
- Token verification is performed server-side with the Firebase Admin SDK. Client-supplied UIDs in request bodies or query parameters are never trusted for authorization.

### Secret isolation
- Service account keys, Firebase credentials, and external API keys (`GEMINI_API_KEY`) must never be committed to Git.
- Test suites use synthetic mock credentials (`fake-api-key`, `LocalTestPassword123!`) designed strictly for the ephemeral, local in-memory Firebase Emulator.

### Child data privacy (RA 10173)
- In compliance with the Philippine Data Privacy Act of 2012 (RA 10173) and project safeguard NFR-PRIV-02, child names, exact birth dates, and qualitative journal entries are never transmitted to external AI providers or logged in server telemetry.
- Caregivers may export all personal data via `GET /api/v1/me/export` or permanently erase their accounts and all nested child records via `DELETE /api/v1/me`.

### Academic scope
- Vulnerabilities are triaged on a best-effort basis by undergraduate students during the academic semester without commercial service-level agreements (SLAs).
