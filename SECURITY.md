# Security Policy — LittleSteps API

This repository contains the backend API services for LittleSteps. For the comprehensive cross-repository security, privacy, and child data policies, refer to the [canonical Security Policy in `littlesteps-docs`](https://github.com/Thesis-Titans/littlesteps-docs/blob/main/SECURITY.md).

---

## 1. Supported Versions

Only the latest commit on the `main` branch of `littlesteps-api` is actively maintained and evaluated for security:

| Branch | Status |
| :--- | :---: |
| `main` | :white_check_mark: Supported |
| All other branches / forks | :x: Not supported |

---

## 2. Reporting a Vulnerability

> [!IMPORTANT]
> **Do NOT report potential security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Please report vulnerabilities privately through either channel:

1. **GitHub Private Vulnerability Reporting (Preferred):**  
   Navigate to the **Security** tab of this repository and click **Report a vulnerability** to open a private advisory draft.
2. **Direct Contact:**  
   Email project lead and maintainer **Mark Alvin Cadangin** at [markcadangin@gmail.com](mailto:markcadangin@gmail.com) with the subject prefix `[SECURITY] LittleSteps API: <Brief Description>`.

---

## 3. High-Priority API Security Boundaries

- **Broken Object Level Authorization (BOLA):** Any vulnerability allowing one caregiver to access, view, or modify another caregiver's child records, journal entries, or developmental summaries is treated as the highest internal priority.
- **Token Verification:** Authentication must verify Firebase ID tokens server-side; client-supplied UIDs must never be trusted without verification.
- **Secret Isolation:** Cloud credentials, Firebase service account keys, and third-party API tokens must never be committed. Mock values in `test/auth-emulator.test.ts` are strictly synthetic throwaway inputs for local in-memory emulator tests.
- **Academic Context:** Vulnerabilities are triaged on a best-effort basis by undergraduate students during academic terms without commercial SLAs.
