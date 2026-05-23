# Contributing to CERNIQ

> Internal-only repo today. This document also serves as the bar for any
> future external contributors when the SDK + docs site go public.

## Before you start

1. Read `CLAUDE.md` — the operating contract for parallel work.
2. Read `WORK_BOARD.md` — claim a module before touching it.
3. Read `docs/SECURITY.md` — every change is evaluated against the
   architecture invariants there.

## Setup

```bash
# Node 22 LTS, pnpm 9.15+
pnpm install
cp .env.example .env
pnpm db:up              # Postgres + Redis
pnpm db:migrate         # Apply schema
pnpm db:seed            # Seed dev principal + agent + policy
pnpm dev                # API + dashboard concurrently
```

## Commit conventions

- **Conventional commits**, enforced by `commitlint`: `feat(verify): cache
agent record for 60s in Redis`.
- Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
  `ci`, `chore`, `revert`, `security`.
- Subject ≤ 100 chars, lowercase preferred (`subject-case: never upper`).
- Body explains _why_, not _what_ — the diff is the _what_.

## Branch model

- `main` — protected. Direct push disabled. CI must pass.
- `feature/<scope>-<slug>` — short-lived. Squash-merge.
- `hotfix/<issue>-<slug>` — for SEV-1/2 production fixes. Cherry-pick to `main`
  and the active release branch.

## Pull requests

- Title follows conventional commit format.
- Body must include:
  - **Why** — link the WORK_BOARD entry or issue.
  - **Test plan** — what you ran, what you observed.
  - **Risk** — security, data, or compliance implications.
  - **Rollback** — how to revert if it goes sideways in prod.
- One reviewer minimum; **two** for changes to crypto code, audit chain,
  or anything in `apps/api/src/common/crypto/**`.

## Quality gates (local + CI)

| Gate         | Local             | CI                           |
| ------------ | ----------------- | ---------------------------- |
| Lint         | `pnpm lint`       | required                     |
| Typecheck    | `pnpm typecheck`  | required                     |
| Unit tests   | `pnpm test`       | required                     |
| E2E tests    | `pnpm test:e2e`   | required (DB+Redis services) |
| Build        | `pnpm build`      | required                     |
| Secrets scan | (pre-commit hook) | gitleaks step                |
| Dep audit    | `pnpm audit`      | weekly job                   |

## Code style

- TypeScript strict mode is non-negotiable. `any` requires a `// type-rationale:` comment justifying it.
- No fabricated data, no Math.random in production paths, no fallback values for observability.
- Errors are typed (`CerniqError` subclasses), not strings.
- Public methods on services have a `.spec.ts` (or `// untestable: <reason>`).
- Crypto code requires a paired `.spec.ts`. No exceptions.

## Releasing

- Changesets: `pnpm changeset` to record a versioned change.
- The CI release workflow opens a PR with version bumps; merging that PR
  publishes any `@cerniq/sdk` / `@cerniq/types` changes to npm.
- The API and dashboard deploy on merge to `main` via Railway.

## Threat-model checklist for any change touching auth, audit, or verify

- [ ] Could this expose a private key in any log line?
- [ ] Could this allow cross-principal data access?
- [ ] Could this re-order denial precedence (per `docs/SECURITY.md` § 6)?
- [ ] Does it preserve the audit chain (no UPDATE / DELETE on AuditEvent)?
- [ ] Does it handle the verify hot-path within latency budget?
- [ ] Is there a metric / alert for the new failure mode?
