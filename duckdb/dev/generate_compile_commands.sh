#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

CPP_SOURCE_DIR="${PROJECT_ROOT}/libs/cpp"
CPP_BUILD_DIR="${PROJECT_ROOT}/libs/cpp/build/debug"

[ -x "$(command -v cmake)" ] \
    && { echo "[ OK  ] Command: cmake"; } \
    || { echo "[ ERR ] Command: cmake"; exit 1; }

set -x

mkdir -p ${CPP_BUILD_DIR}

cmake \
    -S${CPP_SOURCE_DIR} \
    -B${CPP_BUILD_DIR} \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=1 \
    && { echo "[ OK  ] Configure project"; } \
    || { echo "[ ERR ] Configure project"; exit 1; }

ln -s ${CPP_BUILD_DIR}/compile_commands.json ${CPP_SOURCE_DIR}/compile_commands.json

