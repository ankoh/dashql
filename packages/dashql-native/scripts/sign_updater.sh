#!/usr/bin/env bash
set -euo pipefail

# Signs a .app.tar.gz for the Tauri updater.
#
# Required env vars:
#   TAURI_SIGNING_PRIVATE_KEY          - Private key string (as used by tauri signer)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD - Password for the key (may be empty)
#
# Usage:
#   sign_updater.sh <DashQL.app.tar.gz>
#
# Output:
#   <file>.sig alongside the input file.

TAR_GZ="${1:?Usage: sign_updater.sh <tar.gz file>}"

if [ ! -f "$TAR_GZ" ]; then
    echo "Error: file not found: $TAR_GZ" >&2
    exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    echo "Error: TAURI_SIGNING_PRIVATE_KEY env var not set" >&2
    exit 1
fi

PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if command -v cargo-tauri &>/dev/null; then
    cargo tauri signer sign -k "$TAURI_SIGNING_PRIVATE_KEY" -p "$PASSWORD" "$TAR_GZ"
elif command -v npx &>/dev/null; then
    npx @tauri-apps/cli signer sign -k "$TAURI_SIGNING_PRIVATE_KEY" -p "$PASSWORD" "$TAR_GZ"
else
    echo "Error: Neither cargo-tauri nor npx found." >&2
    echo "Install with: cargo install tauri-cli" >&2
    exit 1
fi

echo "Signed: ${TAR_GZ}.sig"
