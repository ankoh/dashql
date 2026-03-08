#!/usr/bin/env bash

set -euo pipefail

APP_DIR="$BUILD_WORKSPACE_DIRECTORY/packages/dashql-app"
VITE_BIN="$BUILD_WORKSPACE_DIRECTORY/node_modules/vite/bin/vite.js"

set -x

rm -f "$APP_DIR/vite.config.dev.ts"
cp "$1" "$APP_DIR/vite.config.dev.ts"

cd "$APP_DIR"
exec ${VITE_BIN} --config vite.config.dev.ts
