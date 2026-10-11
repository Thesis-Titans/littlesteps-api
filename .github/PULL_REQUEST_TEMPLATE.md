## Summary
<!-- Provide a brief description of the rationale and changes introduced by this pull request. -->

## Linked Issue
<!-- Link the relevant issue (e.g., Fixes #123, Addresses Thesis-Titans/littlesteps-docs#8). -->

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New endpoint or feature
- [ ] Documentation or OpenAPI contract update
- [ ] Refactoring or test suite improvement
- [ ] Dependency, tooling, or CI update

## Verification & Commands Run
<!-- List the exact local commands run and their outcomes. -->
- [ ] `npm ci` — dependencies clean
- [ ] `npm run lint` — ESLint passed with 0 errors
- [ ] `npm run typecheck` — TypeScript check passed
- [ ] `npm run build` — build output generated cleanly
- [ ] `npm test` — unit tests passing
- [ ] `npm run test:emulator` — Auth Emulator integration tests passing

## Security, Privacy & Data Handling
- [ ] Confirmed zero real child or caregiver data used (strictly synthetic data)
- [ ] Confirmed zero credentials, keys, or secrets committed
- [ ] In-memory emulator mock keys (`fake-api-key`, `LocalTestPassword123!`) remain strictly isolated to tests
- [ ] Server-side authorization checks verified (UID derived from verified token, not client request)

## Documentation & API Contracts
- [ ] `openapi/openapi.yaml` synchronized with route or schema changes (or not applicable)
- [ ] Canonical documentation in `littlesteps-docs` updated (if workflow or architecture changed)

## Known Limitations
<!-- List any intentional limitations or follow-up tasks. -->
