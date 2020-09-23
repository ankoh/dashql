#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

IMAGE_TAG="1.40.1"
CORE_BUILD_DIR="${PROJECT_ROOT}/core/build/emscripten"
CORE_SOURCE_DIR="${PROJECT_ROOT}/core"
APP_LIB_DIR="${PROJECT_ROOT}/core/build/package"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/root/.emscripten_cache/ dashql/dashql-dev:${IMAGE_TAG} "
if [ -n "${JENKINS_BUILD}" ]; then
    CMD_PREFIX="/opt/emsdk/upstream/emscripten/"
fi
EMCONFIGURE="${CMD_PREFIX}emcmake"
EMMAKE="${CMD_PREFIX}emmake"

set -x

mkdir -p ${CORE_BUILD_DIR}

${EMCONFIGURE} cmake \
    -S/wd/core/ \
    -B/wd/core/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/core/build/emscripten \
    -j$(nproc) \
    dashql_core

mkdir -p "${APP_LIB_DIR}"

cp ${CORE_SOURCE_DIR}/build/emscripten/dashql_core.{wasm,js} "${APP_LIB_DIR}"
