#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

WEBAPI_SOURCE_DIR="${PROJECT_ROOT}/libs/cpp"
WEBAPI_BUILD_DIR="${PROJECT_ROOT}/libs/cpp/build/debug"

[ -x "$(command -v cmake)" ] \
    && { echo "[ OK  ] Command: cmake"; } \
    || { echo "[ ERR ] Command: cmake"; exit 1; }

set -x

mkdir -p ${WEBAPI_BUILD_DIR}

cmake \
    -S${WEBAPI_SOURCE_DIR} \
    -B${WEBAPI_BUILD_DIR} \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=1 \
    && { echo "[ OK  ] Configure project"; } \
    || { echo "[ ERR ] Configure project"; exit 1; }

ln -s ${WEBAPI_BUILD_DIR}/compile_commands.json ${WEBAPI_SOURCE_DIR}/compile_commands.json

