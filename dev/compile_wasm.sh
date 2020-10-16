#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

DEV_IMAGE="dashql/duckdb.wasm-dev:0.1"

CPP_BUILD_DIR="${PROJECT_ROOT}/libs/cpp/build/emscripten"
CPP_SOURCE_DIR="${PROJECT_ROOT}/libs/cpp"
JS_LIB_DIR="${PROJECT_ROOT}/libs/js/src/duckdb"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/mnt/emscripten_cache/ ${DEV_IMAGE} "
EMCONFIGURE="${CMD_PREFIX} emcmake"
EMMAKE="${CMD_PREFIX} emmake"

set -x

mkdir -p ${CPP_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

${EMCONFIGURE} cmake \
    -S/wd/libs/cpp/ \
    -B/wd/libs/cpp/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/libs/cpp/build/emscripten \
    -j${CORES} \
    duckdb_webapi duckdb_nodeapi

mkdir -p "${JS_LIB_DIR}"

cp ${CPP_SOURCE_DIR}/build/emscripten/duckdb_*.{wasm,js,worker.js} "${JS_LIB_DIR}"

