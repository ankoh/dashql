#!/usr/bin/env bash
# Copies Bazel-built dashql-core/api dist into packages/dashql-core/api/dist
# so that dashql-app (link:../dashql-core/api) and tests see the same layout.
# Run after: bazel build //packages/dashql-core/api:dist_wasm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BAZEL_BIN="${BAZEL_BIN:-$ROOT/bazel-bin}"
PKG_DIST="$ROOT/packages/dashql-core/api/dist"
SRC="$BAZEL_BIN/packages/dashql-core/api/dist_wasm"

if [[ ! -d "$SRC" ]]; then
  echo "Bazel dist not found at $SRC. Run: bazel build //packages/dashql-core/api:dist_wasm" >&2
  exit 1
fi

mkdir -p "$PKG_DIST"
rm -rf "$PKG_DIST"/*
cp -r "$SRC"/* "$PKG_DIST/"
echo "Copied Bazel dist to $PKG_DIST"
