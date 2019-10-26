#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

CORE_SOURCE_DIR="${PROJECT_ROOT}/tigon-core"
CORE_BUILD_DIR="${PROJECT_ROOT}/tigon-core/build/debug"

[ -x "$(command -v cmake)" ] \
    && { echo "[ OK  ] Command: cmake"; } \
    || { echo "[ ERR ] Command: cmake"; exit 1; }

set -x

mkdir -p ${CORE_BUILD_DIR}

cmake \
    -S${CORE_SOURCE_DIR} \
    -B${CORE_BUILD_DIR} \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=1 \
    && { echo "[ OK  ] Configure project"; } \
    || { echo "[ ERR ] Configure project"; exit 1; }

ln -s ${CORE_BUILD_DIR}/compile_commands.json ${CORE_SOURCE_DIR}/compile_commands.json
