#!/usr/bin/env bash
# Runs utils/check_dev_hmr.mjs with the Node of the host, like the dev server, see utils/dev.sh
set -euo pipefail
exec node "$BUILD_WORKSPACE_DIRECTORY/packages/dashql-app/utils/check_dev_hmr.mjs" "$(realpath "$1")" "$(realpath "$2")"
