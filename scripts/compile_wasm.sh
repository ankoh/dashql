#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

BUILD_TYPE=${1:-Release}
echo "BUILD_TYPE=${BUILD_TYPE}"

CPP_BUILD_DIR="${PROJECT_ROOT}/core/cpp/build/wasm/${BUILD_TYPE}"
CPP_SOURCE_DIR="${PROJECT_ROOT}/core/cpp"
CORE_JS_LIB_DIR="${PROJECT_ROOT}/core/js/src/wasm"
DUCKDB_JS_LIB_DIR="${PROJECT_ROOT}/duckdb/js/src/wasm"
set -x

mkdir -p ${CPP_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

emcmake cmake \
    -S/wd/core/cpp/ \
    -B/wd/core/cpp/build/wasm/${BUILD_TYPE} \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"

emmake make \
    -C/wd/core/cpp/build/wasm/${BUILD_TYPE} \
    -j${CORES} \
    core_web core_node duckdb_web duckdb_node

cp ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/*.{wasm,js} "${CORE_JS_LIB_DIR}"
cp ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/duckdb/*.{wasm,js} "${DUCKDB_JS_LIB_DIR}"
