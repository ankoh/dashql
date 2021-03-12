#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

CORE_PKG_FILE="${PROJECT_ROOT}/core/package.json"
WEBDB_PKG_FILE="${PROJECT_ROOT}/webdb/package.json"

function get_pkg_version() {
    cat $1|grep version|head -1|awk -F: '{ print $2 }'|sed 's/[", ]//g'
}

CORE_VERSION="$(get_pkg_version ${CORE_PKG_FILE})"
WEBDB_VERSION="$(get_pkg_version ${WEBDB_PKG_FILE})"

function release() {
    PKG_DIR="$1"
    PKG_NAME="$2"

    #echo "Build ${PKG_NAME}"
    #npm --prefix ${PKG_DIR} run build

    echo "Check ${PKG_NAME}"
    if [ -z "$(npm --silent --prefix ${PKG_DIR} info "${PKG_NAME}")" ]; then
        npm --prefix ${PKG_DIR} publish "${PKG_NAME}"
    else
        echo "Package ${PKG_NAME} already published"
    fi
}

release "${PROJECT_ROOT}/webdb" "@dashql/webdb@${WEBDB_VERSION}"
release "${PROJECT_ROOT}/core" "@dashql/core@${CORE_VERSION}"

