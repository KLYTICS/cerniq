#!/usr/bin/env sh
# OKORO CLI installer.
#
# Usage:
#   curl -fsSL https://get.okoro.dev/install.sh | sh
#   curl -fsSL https://get.okoro.dev/install.sh | sh -s -- --version v0.2.0
#   curl -fsSL https://get.okoro.dev/install.sh | sh -s -- --prefix ~/.local
#
# What it does:
#   1. Detects host OS + arch (darwin/linux/windows × amd64/arm64).
#   2. Resolves the requested version (default: latest GitHub release).
#   3. Downloads the release tarball + checksums.
#   4. Verifies the SHA-256 against the published checksums file.
#   5. Optionally verifies the cosign signature (OKORO_VERIFY_SIGNATURE=1).
#   6. Extracts to the chosen prefix and verifies `okoro --version` runs.
#
# What it does NOT do:
#   - Modify your shell rc files. Add ${PREFIX}/bin to PATH yourself.
#   - Auto-update. Re-run the installer to upgrade; this is intentional —
#     auto-updating CLIs are a footgun for production environments that
#     pin specific versions for reproducibility.

set -eu

# -----------------------------------------------------------------
# defaults — overridable via flags or env
# -----------------------------------------------------------------

REPO="${OKORO_REPO:-klytics/okoro}"
VERSION="${OKORO_VERSION:-latest}"
PREFIX="${OKORO_PREFIX:-/usr/local}"
VERIFY_SIGNATURE="${OKORO_VERIFY_SIGNATURE:-0}"
TMP_ROOT="${TMPDIR:-/tmp}/okoro-install.$$"

# -----------------------------------------------------------------
# arg parsing — minimal getopt to keep portable across BSD + GNU
# -----------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --prefix) PREFIX="$2"; shift 2 ;;
        --verify-signature) VERIFY_SIGNATURE=1; shift ;;
        --help|-h)
            cat <<EOF
okoro-install — install the OKORO CLI

  --version <tag>      install a specific tag (default: latest release)
  --prefix <dir>       install root (default: /usr/local)
  --verify-signature   require cosign verification of the release archive
  --help, -h           this message

Environment variables:
  OKORO_REPO              GitHub repo (default: klytics/okoro)
  OKORO_VERSION           release tag (default: latest)
  OKORO_PREFIX            install root (default: /usr/local)
  OKORO_VERIFY_SIGNATURE  if set to 1, require cosign verification
EOF
            exit 0
            ;;
        *) echo "okoro-install: unknown flag $1" >&2; exit 2 ;;
    esac
done

# -----------------------------------------------------------------
# detect host OS + arch
# -----------------------------------------------------------------

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

case "$UNAME_S" in
    Darwin) OS="darwin" ;;
    Linux) OS="linux" ;;
    MINGW*|CYGWIN*|MSYS*) OS="windows" ;;
    *) echo "okoro-install: unsupported OS $UNAME_S" >&2; exit 1 ;;
esac

case "$UNAME_M" in
    x86_64|amd64) ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo "okoro-install: unsupported arch $UNAME_M" >&2; exit 1 ;;
esac

# -----------------------------------------------------------------
# resolve the version
# -----------------------------------------------------------------

if [ "$VERSION" = "latest" ]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | grep -E '"tag_name":' | head -n1 | cut -d'"' -f4)"
    if [ -z "$VERSION" ]; then
        echo "okoro-install: could not resolve latest release tag" >&2
        exit 1
    fi
fi

EXT="tar.gz"
[ "$OS" = "windows" ] && EXT="zip"
ARCHIVE="okoro_${VERSION#v}_${OS}_${ARCH}.${EXT}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"
CHECKSUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"

# -----------------------------------------------------------------
# download + verify + install
# -----------------------------------------------------------------

mkdir -p "$TMP_ROOT"
trap 'rm -rf "$TMP_ROOT"' EXIT

echo "okoro-install: ${OS}/${ARCH} ${VERSION} → ${PREFIX}/bin/okoro" >&2

curl -fsSL "$URL" -o "${TMP_ROOT}/${ARCHIVE}"
curl -fsSL "$CHECKSUMS_URL" -o "${TMP_ROOT}/checksums.txt"

# Checksum verification — fail-closed if the archive doesn't match.
EXPECTED="$(grep "$ARCHIVE" "${TMP_ROOT}/checksums.txt" | awk '{print $1}')"
if [ -z "$EXPECTED" ]; then
    echo "okoro-install: archive ${ARCHIVE} not listed in checksums.txt — refusing to install" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "${TMP_ROOT}/${ARCHIVE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "${TMP_ROOT}/${ARCHIVE}" | awk '{print $1}')"
else
    echo "okoro-install: neither sha256sum nor shasum available — cannot verify checksum" >&2
    exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "okoro-install: checksum mismatch — expected ${EXPECTED}, got ${ACTUAL}" >&2
    exit 1
fi

# Optional cosign verification. If VERIFY_SIGNATURE=1 and cosign isn't
# installed, fail closed — the operator asked for a stronger guarantee.
if [ "$VERIFY_SIGNATURE" = "1" ]; then
    if ! command -v cosign >/dev/null 2>&1; then
        echo "okoro-install: --verify-signature requires cosign on PATH" >&2
        exit 1
    fi
    SIG_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt.sig"
    PEM_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt.pem"
    curl -fsSL "$SIG_URL" -o "${TMP_ROOT}/checksums.txt.sig"
    curl -fsSL "$PEM_URL" -o "${TMP_ROOT}/checksums.txt.pem"
    cosign verify-blob \
        --certificate "${TMP_ROOT}/checksums.txt.pem" \
        --signature "${TMP_ROOT}/checksums.txt.sig" \
        --certificate-identity-regexp 'https://github\.com/'"${REPO}"'/.+' \
        --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
        "${TMP_ROOT}/checksums.txt"
fi

# Extract.
mkdir -p "${TMP_ROOT}/extract"
case "$EXT" in
    tar.gz) tar -xzf "${TMP_ROOT}/${ARCHIVE}" -C "${TMP_ROOT}/extract" ;;
    zip) unzip -q "${TMP_ROOT}/${ARCHIVE}" -d "${TMP_ROOT}/extract" ;;
esac

# Install.
mkdir -p "${PREFIX}/bin"
BIN_NAME="okoro"
[ "$OS" = "windows" ] && BIN_NAME="okoro.exe"
install -m 0755 "${TMP_ROOT}/extract/${BIN_NAME}" "${PREFIX}/bin/${BIN_NAME}" 2>/dev/null \
    || cp "${TMP_ROOT}/extract/${BIN_NAME}" "${PREFIX}/bin/${BIN_NAME}"
chmod 0755 "${PREFIX}/bin/${BIN_NAME}"

# Smoke check — confirm the binary actually runs on this host.
if ! "${PREFIX}/bin/${BIN_NAME}" --version >/dev/null 2>&1; then
    echo "okoro-install: installed binary failed --version check" >&2
    exit 1
fi

echo "okoro-install: installed $(${PREFIX}/bin/${BIN_NAME} --version)" >&2
echo "okoro-install: next: okoro login --help" >&2
