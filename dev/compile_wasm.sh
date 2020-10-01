#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

IMAGE_TAG="0.1"
WEBAPI_BUILD_DIR="${PROJECT_ROOT}/webapi/build/emscripten"
WEBAPI_SOURCE_DIR="${PROJECT_ROOT}/webapi"
LIB_DIR="${PROJECT_ROOT}/jslib/src/duckdb"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/root/.emscripten_cache/ dashql/emsdk:${IMAGE_TAG} "
EMCONFIGURE="${CMD_PREFIX} emcmake"
EMMAKE="${CMD_PREFIX} emmake"

set -x

mkdir -p ${WEBAPI_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

${EMCONFIGURE} cmake \
    -S/wd/webapi/ \
    -B/wd/webapi/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/webapi/build/emscripten \
    -j${CORES} \
    duckdb_webapi duckdb_nodeapi

mkdir -p "${LIB_DIR}"

cp ${WEBAPI_SOURCE_DIR}/build/emscripten/duckdb_*.{wasm,js,worker.js} "${LIB_DIR}"

