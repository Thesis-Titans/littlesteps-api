---
name: API Bug Report
about: Report an issue, defective endpoint, or test failure in the API
title: "[API-BUG]: "
labels: bug
assignees: ""
---

## Description
<!-- A clear and concise description of the bug. -->

## Endpoint & Method
- **Method:** <!-- GET / POST / PUT / DELETE -->
- **Path:** <!-- e.g., /health, /api/v1/me -->

## Reproduction Steps
1. Start local emulators: `npm run emulators` (or describe test command)
2. Send request: `curl ...`
3. See error response

## Expected Behavior
<!-- What HTTP status and response payload you expected. -->

## Actual Behavior
<!-- Actual status code and sanitized response (ensure no real tokens or sensitive data are included). -->

## Environment
- **Node.js:** <!-- e.g., v22.x -->
- **Firebase Tools version:** <!-- e.g., 14.x -->
- **OS:** <!-- Linux / macOS / Windows -->

## Safety & Privacy Confirmation
- [ ] Confirmed no real personal data (caregiver/child) is included.
- [ ] Confirmed no real tokens, keys, or secrets are pasted in logs above.
