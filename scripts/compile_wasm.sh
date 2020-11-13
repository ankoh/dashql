#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

IMAGE_TAG="0.2"
CPP_BUILD_DIR="${PROJECT_ROOT}/core/cpp/build/emscripten"
CPP_SOURCE_DIR="${PROJECT_ROOT}/core/cpp"
JS_LIB_DIR="${PROJECT_ROOT}/core/js/src/wasm"

CMD_PREFIX="docker run -it --rm -v${PROJECT_ROOT}:/wd/ -v${PROJECT_ROOT}/.emscripten_cache/:/mnt/emscripten_cache/ dashql/dashql-dev:${IMAGE_TAG} "
EMCONFIGURE="${CMD_PREFIX} emcmake"
EMMAKE="${CMD_PREFIX} emmake"

set -x

mkdir -p ${CPP_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

${EMCONFIGURE} cmake \
    -S/wd/core/cpp/ \
    -B/wd/core/cpp/build/emscripten \
    -DCMAKE_BUILD_TYPE=Release

${EMMAKE} make \
    -C/wd/core/cpp/build/emscripten \
    -j${CORES} \
    dashql_core_web dashql_core_node

mkdir -p "${JS_LIB_DIR}"

cp ${CPP_SOURCE_DIR}/build/emscripten/dashql_*.{wasm,js} "${JS_LIB_DIR}"

