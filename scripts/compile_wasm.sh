#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

IMAGE_TAG="0.2"
CPP_BUILD_DIR="${PROJECT_ROOT}/core/cpp/build/emscripten"
CPP_SOURCE_DIR="${PROJECT_ROOT}/core/cpp"
CORE_JS_LIB_DIR="${PROJECT_ROOT}/core/js/src/wasm"
DUCKDB_JS_LIB_DIR="${PROJECT_ROOT}/duckdb/js/src/wasm"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/mnt/emscripten_cache/ -v${PROJECT_ROOT}/.ccache/:/mnt/ccache/ -e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=/wd/core/cpp/ dashql/ci:${IMAGE_TAG} "

set -x

mkdir -p ${CPP_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

${CMD_PREFIX} emcmake cmake \
    -S/wd/core/cpp/ \
    -B/wd/core/cpp/build/emscripten \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    -DCMAKE_BUILD_TYPE=Release

${CMD_PREFIX} emmake make \
    -C/wd/core/cpp/build/emscripten \
    -j${CORES} \
    dashql_core_web dashql_core_node duckdb_web duckdb_node

cp ${CPP_SOURCE_DIR}/build/emscripten/dashql_*.{wasm,js} "${CORE_JS_LIB_DIR}"
cp ${CPP_SOURCE_DIR}/build/emscripten/duckdb/duckdb_*.{wasm,js} "${DUCKDB_JS_LIB_DIR}"

