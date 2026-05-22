# OKORO CLI — security & credential lifecycle

> Companion to `docs/SECURITY.md` covering the operator CLI specifically.
> Source-of-truth for "where do my credentials actually live and how do
> I rotate them."

## Credential storage by platform

| Platform | Backend                       | Path / namespace                                                                |
| -------- | ----------------------------- | ------------------------------------------------------------------------------- |
| macOS    | Keychain.app                  | service `io.okorolabs.cli`, account `api_key` / `verify_key`                    |
| Linux    | Secret Service (libsecret)    | collection `okoro`, label prefix `OKORO — `                                     |
| Windows  | Credential Manager (WinCred)  | target prefix `io.okorolabs.cli/`                                               |
| Fallback | Encrypted file (CI, headless) | `~/.config/okoro/keychain/` (mode 0600), per-host random secret in same dir     |

The fallback exists so CI runs with no DBus / no Keychain.app still
work. The per-host secret is *not* a substitute for an OS keychain — a
filesystem-level compromise reads it. CI users should pass `--api-key`
or `OKORO_API_KEY` directly and skip persistence.

## Credential precedence

Every command resolves credentials in this order:

```
--api-key flag → $OKORO_API_KEY → keychain (api_key entry)
--verify-key flag → $OKORO_VERIFY_KEY → keychain (verify_key entry)
```

The first non-empty value wins. The CLI never silently mixes — if you
set `--api-key`, the keychain is not consulted for that command.

## What lives where

| Material                            | Where                                    | Why                                                                                                                         |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Management API key (`okoro_sk_…`)   | OS keychain entry `api_key`              | Mutates agents/policies/audit; deserves the strongest local store.                                                          |
| Verify-only key (`okoro_vk_…`)      | OS keychain entry `verify_key`           | Read-only `/verify`; held by relying parties. Separate so RP machines don't accidentally inherit management privilege.       |
| Agent private key (Ed25519)         | **NEVER** in the CLI keychain            | CLAUDE.md invariant 1: OKORO holds public keys only. `okoro agents register --generate-keypair` prints the private key once and the operator persists it via their own secret store (1Password, HSM, env var injection at runtime). |
| Config file (non-secret)            | `$XDG_CONFIG_HOME/okoro/config.toml`     | Holds base URL + cosmetic email; readable by user only (mode 0600). No tokens.                                              |
| Device-code refresh token (future)  | OS keychain entry `oauth_refresh`        | Will land with M-040a; rotated on every `okoro login`.                                                                      |

## Rotation playbook

### Rotating an API key

```sh
# 1. Mint a new key in the dashboard
# 2. Replace the local credential
okoro logout                            # purges api_key entry
okoro login --api-key okoro_sk_NEW_VALUE

# 3. Verify
okoro whoami                            # should show the same principal
okoro doctor                            # 10-check battery; all green

# 4. Revoke the old key in the dashboard
```

### Rotating a verify-only key

```sh
okoro logout --scope verify             # purge verify_key entry only
# (when --scope verify lands; today: clear the keychain entry manually)
export OKORO_VERIFY_KEY=okoro_vk_NEW
okoro verify "$TOKEN" --action commerce.purchase --amount 1
```

### Rotating after suspected compromise

1. Revoke the key in the dashboard **immediately** — this invalidates
   it server-side regardless of where copies are cached.
2. `okoro events tail <agent>` to watch for any final usage in real
   time. Audit chain integrity is preserved (CLAUDE.md invariant 3) —
   a compromised key cannot rewrite history.
3. Rotate at every machine that held a copy. Audit `~/.config/okoro/`
   on each machine for the fallback file backend.

## Threat model — CLI-specific

| Threat                                | Mitigation                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Local privilege escalation reads keys | OS keychain backends gate by user; fallback file is mode 0600.                                      |
| Stolen laptop                         | Keychain is unlocked by login session; full-disk encryption is the operator's first line.           |
| Keychain backup synced to cloud       | macOS Keychain in iCloud syncs encrypted blob; equivalent vendor encryption on Windows/Linux.       |
| `--api-key` in shell history          | Use the keychain (no flag) or `export OKORO_API_KEY=...` once and rely on the env precedence.       |
| Plugin steals credentials             | Plugins inherit `os.Environ()` — they see `OKORO_API_KEY` if exported. Audit your plugin set.       |
| MITM on the API call                  | TLS pinning is NOT enforced (yet); the CLI relies on the system trust store. Use `--base-url https`. |

## Audit hooks

Every CLI write (`agents register`, `policy create`, `agents revoke`,
`policy revoke`, `report`) lands in the OKORO audit chain and surfaces
in `okoro events tail <agent>` within seconds. The audit row carries
the source IP, user-agent (`okoro-cli/<version>`), and the originating
principal — sufficient to reconstruct who did what from the terminal.

## Related

- `docs/SECURITY.md` — the full threat model + crypto contract.
- `docs/PLUGIN_AUTHORS.md` — plugin contract; what env vars plugins
  may and may not assume.
- `OPERATOR_DECISIONS.md` OD-009 — device-code OAuth decision rationale.
