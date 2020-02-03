#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

IMAGE_TAG="a5082b2"
CORE_BUILD_DIR="${PROJECT_ROOT}/tigon-core/build/emscripten"
CORE_SOURCE_DIR="${PROJECT_ROOT}/tigon-core"
APP_LIB_DIR="${PROJECT_ROOT}/tigon-app/public/lib"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/root/.emscripten_cache/ ankoh/tigon-dev:${IMAGE_TAG} "
EMCONFIGURE="${CMD_PREFIX} emconfigure"
EMMAKE="${CMD_PREFIX} emmake"

set -ex

mkdir -p ${CORE_BUILD_DIR}

${EMCONFIGURE} cmake \
    -S/wd/tigon-core/ \
    -B/wd/tigon-core/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/tigon-core/build/emscripten \
    -j$(nproc) \
    tigon_core

cp ${CORE_SOURCE_DIR}/build/emscripten/tigon_core.{wasm,js} ${APP_LIB_DIR}
