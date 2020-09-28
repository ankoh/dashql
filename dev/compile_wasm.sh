#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

IMAGE_TAG="2.0.4"
CORE_BUILD_DIR="${PROJECT_ROOT}/core/build/emscripten"
CORE_SOURCE_DIR="${PROJECT_ROOT}/core"
APP_LIB_DIR="${PROJECT_ROOT}/app/public/core"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/root/.emscripten_cache/ dashql/dashql-dev:${IMAGE_TAG} "
EMCONFIGURE="${CMD_PREFIX} emcmake"
EMMAKE="${CMD_PREFIX} emmake"

set -x

mkdir -p ${CORE_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

${EMCONFIGURE} cmake \
    -S/wd/core/ \
    -B/wd/core/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/core/build/emscripten \
    -j${CORES} \
    dashql_core

mkdir -p "${APP_LIB_DIR}"
cp ${CORE_SOURCE_DIR}/build/emscripten/dashql_core.{wasm,js,worker.js} "${APP_LIB_DIR}"
