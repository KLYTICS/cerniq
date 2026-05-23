# API client collections

Exported request collections for popular API clients — auto-generated
from `docs/spec/CERNIQ_API_SPEC.yaml` so they stay in lockstep with
the wire contract.

## Available collections

| Tool     | File                   | Generation                                                                                |
| -------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| Postman  | `cerniq.postman.json`  | `npx openapi-to-postmanv2 -s ../../docs/spec/CERNIQ_API_SPEC.yaml -o cerniq.postman.json` |
| Insomnia | `cerniq.insomnia.yaml` | `npx openapi-2-insomnia ../../docs/spec/CERNIQ_API_SPEC.yaml > cerniq.insomnia.yaml`      |
| Bruno    | `cerniq.bruno/`        | `npx openapi-to-bruno --input ../../docs/spec/CERNIQ_API_SPEC.yaml --output cerniq.bruno` |
| HTTPie   | `cerniq.httpie.json`   | manually maintained — small enough that auto-gen isn't worth the dep                      |

These files are checked in so a developer doesn't need a Node toolchain
to import them. The generation commands above are the contract for how
they update — wire them to CI so a spec change forces a collection
refresh in the same PR.

## Auth

All four collections expect:

- `CERNIQ_BASE_URL` (default `https://api.cerniqapp.com`)
- `CERNIQ_API_KEY` (an `cerniq_sk_…` for management endpoints)
- `CERNIQ_VERIFY_KEY` (an `cerniq_vk_…` for the verify-only endpoints)

Set these as collection-level variables; never hard-code keys in the
exported file.

## Status

Collections will land alongside the first goreleaser drop (M-040b).
Until then, this directory is a placeholder describing the contract.
The `cerniq init --industry <x>` scaffolds in `examples/<x>/` are the
working integration today; collections are an additional surface for
exploration without writing code.
