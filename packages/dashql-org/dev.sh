#!/usr/bin/env bash
# Runs the Astro dev server in the source tree, with the node_modules of `pnpm install`.
# Bazel builds the shared package and the SVG symbols, the generated config points into bazel-bin.

set -euo pipefail

SITE_DIR="$BUILD_WORKSPACE_DIRECTORY/packages/dashql-org"
ASTRO_BIN="$SITE_DIR/node_modules/.bin/astro"

if [ ! -x "$ASTRO_BIN" ]; then
    echo "Missing $ASTRO_BIN, run pnpm install in $BUILD_WORKSPACE_DIRECTORY first" >&2
    exit 1
fi

rm -f "$SITE_DIR/astro.config.dev.ts"
cp "$1" "$SITE_DIR/astro.config.dev.ts"

cd "$SITE_DIR"
ASTRO_TELEMETRY_DISABLED=1 exec "$ASTRO_BIN" dev --config astro.config.dev.ts "${@:2}"
