# API client collections

Exported request collections for popular API clients — auto-generated
from `docs/spec/OKORO_API_SPEC.yaml` so they stay in lockstep with
the wire contract.

## Available collections

| Tool     | File                  | Generation                                                                              |
| -------- | --------------------- | --------------------------------------------------------------------------------------- |
| Postman  | `okoro.postman.json`  | `npx openapi-to-postmanv2 -s ../../docs/spec/OKORO_API_SPEC.yaml -o okoro.postman.json` |
| Insomnia | `okoro.insomnia.yaml` | `npx openapi-2-insomnia ../../docs/spec/OKORO_API_SPEC.yaml > okoro.insomnia.yaml`      |
| Bruno    | `okoro.bruno/`        | `npx openapi-to-bruno --input ../../docs/spec/OKORO_API_SPEC.yaml --output okoro.bruno` |
| HTTPie   | `okoro.httpie.json`   | manually maintained — small enough that auto-gen isn't worth the dep                    |

These files are checked in so a developer doesn't need a Node toolchain
to import them. The generation commands above are the contract for how
they update — wire them to CI so a spec change forces a collection
refresh in the same PR.

## Auth

All four collections expect:

- `OKORO_BASE_URL` (default `https://api.okoroapp.com`)
- `OKORO_API_KEY` (an `okoro_sk_…` for management endpoints)
- `OKORO_VERIFY_KEY` (an `okoro_vk_…` for the verify-only endpoints)

Set these as collection-level variables; never hard-code keys in the
exported file.

## Status

Collections will land alongside the first goreleaser drop (M-040b).
Until then, this directory is a placeholder describing the contract.
The `okoro init --industry <x>` scaffolds in `examples/<x>/` are the
working integration today; collections are an additional surface for
exploration without writing code.
