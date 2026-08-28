#!/usr/bin/env bash
set -euo pipefail

RUNFILES_ROOT="${RUNFILES_DIR:-$0.runfiles}"
WORKSPACE_ROOT="${RUNFILES_ROOT}/_main"
ELECTRON_PACKAGE="${WORKSPACE_ROOT}/node_modules/electron"

export DASHQL_ELECTRON_RENDERER="${WORKSPACE_ROOT}/packages/dashql-app/electron_deploy"
export DASHQL_NATIVE_ADDON="${WORKSPACE_ROOT}/packages/dashql-native-napi/dashql_native_napi.node"
export DASHQL_NATIVE_UTILITY_WORKER="${WORKSPACE_ROOT}/packages/dashql-electron/dist/native_utility_worker.js"
export DASHQL_ELECTRON_PRELOAD="${WORKSPACE_ROOT}/packages/dashql-electron/src/preload.cjs"

if [[ -n "${DASHQL_ELECTRON_USER_DATA_DIR:-}" ]]; then
    exec "${ELECTRON_PACKAGE}/dist/$(<"${ELECTRON_PACKAGE}/path.txt")" \
        "--user-data-dir=${DASHQL_ELECTRON_USER_DATA_DIR}" \
        "${WORKSPACE_ROOT}/packages/dashql-electron/dist/main.js" \
        "$@"
fi

exec "${ELECTRON_PACKAGE}/dist/$(<"${ELECTRON_PACKAGE}/path.txt")" \
    "${WORKSPACE_ROOT}/packages/dashql-electron/dist/main.js" \
    "$@"
