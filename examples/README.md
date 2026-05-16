# AEGIS — Examples

End-to-end examples exercising the public SDK + verifier surfaces. Each one
doubles as an SDK acceptance test — if an example breaks, the SDK contract
drifted.

## Index

| Example                          | Audience                                                  | Surface                                       |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `node-quickstart`                | Developer wiring AEGIS into their own app                 | `@aegis/sdk`                                  |
| `relying-party-verifier`         | Service deciding whether to honor an agent's request      | `@aegis/sdk` (`aegis.verify`)                 |
| `acp-bridge`                     | ACP merchant doing dual-verify (Stripe SPT + AEGIS token) | `@aegis/sdk` + Express                        |
| `fintech-payments`               | Payments-vertical reference integration                   | `@aegis/sdk`                                  |
| `banking-rails`                  | Banking-rails reference integration                       | `@aegis/sdk`                                  |
| `reconciliation`                 | Verify-token reconciliation walkthrough                   | `@aegis/sdk`                                  |
| `ai-platform-tool-call`          | AI-platform integration showing tool-call gating          | `@aegis/sdk`                                  |
| `saas-seat-provisioning`         | SaaS seat-provisioning integration                        | `@aegis/sdk`                                  |
| `preflight-github-action`        | CI gate for relying-party deployments                     | preflight CLI                                 |
| `intent-fintech-acp`             | **Intent Manifest:** ACP merchant verifying locally       | `@aegis/intent-manifest` + `@aegis/verifier-rp` |
| `intent-treasury-iso20022`       | **Intent Manifest:** treasury wire (ISO 20022 pacs.008)   | `@aegis/intent-manifest` + `@aegis/verifier-rp` |
| `intent-broker-dealer-finra`     | **Intent Manifest:** broker-dealer order (FINRA 3110)     | `@aegis/intent-manifest` + `@aegis/verifier-rp` |

## Two flavors

**Online examples** (`node-quickstart`, `relying-party-verifier`, `acp-bridge`,
`fintech-payments`, `banking-rails`, `reconciliation`, `ai-platform-tool-call`,
`saas-seat-provisioning`) exercise the published SDK surface against a running
AEGIS API. Run the dev stack first:

```sh
docker compose -f infra/dev/docker-compose.dev.yml --env-file infra/dev/.env up -d --build
```

Then `pnpm --filter <example-name> demo` (or `dev`/`agent` per example). The
`AEGIS_API_BASE` env var tells each example where to find the API (defaults
to `http://localhost:4000`).

**Offline examples** (`intent-*`) demonstrate the relying-party wedge: the
verifier-rp + kernel verify-and-reconcile flow runs **with no AEGIS API in
the request path**. The signing happens locally in the demo (AEGIS holds the
signer in production via M-051 KMS); the verification is the same code-path
the merchant runs in production against the AEGIS-published JWKS at
`/.well-known/audit-signing-key`. Run with `pnpm --filter <example-name> demo`
— no dev stack required.

## Related

- `docs/spec/AEGIS_API_SPEC.yaml` — public wire contract
- `docs/decisions/` — architecture decisions backing each surface
- `packages/sdk-ts/` — the SDK these examples consume
- `packages/verifier-rp/` — the offline verification surface
- `packages/intent-manifest/` — framework-free kernel for `intent-*` demos
