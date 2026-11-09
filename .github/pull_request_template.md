## Summary

<!-- What does this change and why? Link the phase/task issue: Closes #123 -->

## Phase / scope

- Phase: <!-- e.g. Phase 1 – Foundation -->
- Workspaces touched: <!-- apps/api, apps/web, apps/admin, packages/db, packages/shared, infra -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / tech debt
- [ ] Database migration (schema v1 entity list updated in CLAUDE.md if new entity)
- [ ] Infrastructure / CI
- [ ] Documentation

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally
- [ ] Conventional Commit title (`feat(api): ...`, `fix(web): ...`, `docs(phase-03): ...`)
- [ ] New env vars documented in the relevant `.env.example` and validated with Zod
- [ ] Mutating endpoints write an `AuditLog` row and are covered by `@Permissions()`
- [ ] Money stored as BIGINT minor units + currency; IDs uuid; timestamps timestamptz
- [ ] Migration is expand/contract (backward compatible with the previous release)
- [ ] No secrets, tokens or personal data in code, fixtures or logs
- [ ] Docs updated (`docs/`, READMEs, OpenAPI annotations)

## Testing notes

<!-- How was this verified? Include commands, screenshots for UI, curl examples for API. -->

## Rollout / rollback

<!-- Feature flag? Migration order? Anything the deployer must know. "None" is fine. -->
