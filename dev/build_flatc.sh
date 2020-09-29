#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
FLATBUF_DIR="${PROJECT_ROOT}/submodules/flatbuffers"
FLATC_BASE_DIR="${PROJECT_ROOT}/dev/flatc"
FLATC_BUILD_DIR="${FLATC_BASE_DIR}/build"
FLATC_INSTALL_DIR="${FLATC_BASE_DIR}/install"

[ -x "$(command -v cmake)" ] \
    && { echo "[ OK  ] Command: cmake"; } \
    || { echo "[ ERR ] Command: cmake"; exit 1; }

[ -x "$(command -v ninja)" ] \
    && { echo "[ OK  ] Command: ninja"; } \
    || { echo "[ ERR ] Command: ninja"; exit 1; }

[ -x "$(command -v clang)" ] \
    && { echo "[ OK  ] Command: clang"; } \
    || { echo "[ ERR ] Command: clang"; exit 1; }

if [ -d "${FLATC_BASE_DIR}" ]; then
    rm -r ${FLATC_BASE_DIR}
fi
mkdir -p ${FLATC_BUILD_DIR} ${FLATC_INSTALL_DIR}

cmake \
    -B${FLATC_BUILD_DIR} \
    -GNinja \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_CXX_FLAGS=-std=c++17 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_INSTALL_PREFIX=${FLATC_INSTALL_DIR} \
    -DFLATBUFFERS_BUILD_FLATLIB=ON \
    -DFLATBUFFERS_BUILD_FLATC=ON \
    -DFLATBUFFERS_INSTALL=ON \
    -DFLATBUFFERS_BUILD_TESTS=OFF \
    -DFLATBUFFERS_BUILD_SHAREDLIB=OFF \
    "${FLATBUF_DIR}"

ninja -C ${FLATC_BUILD_DIR} install

