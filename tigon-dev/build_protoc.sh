#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
PROTOBUF_DIR="${PROJECT_ROOT}/submodules/protobuf"
PROTOC_BASE_DIR="${PROJECT_ROOT}/tigon-dev/protoc"
PROTOC_BUILD_DIR="${PROTOC_BASE_DIR}/build"
PROTOC_INSTALL_DIR="${PROTOC_BASE_DIR}/install"

[ -x "$(command -v cmake)" ] \
    && { echo "[ OK  ] Command: cmake"; } \
    || { echo "[ ERR ] Command: cmake"; exit 1; }

[ -x "$(command -v ninja)" ] \
    && { echo "[ OK  ] Command: ninja"; } \
    || { echo "[ ERR ] Command: ninja"; exit 1; }

[ -x "$(command -v clang)" ] \
    && { echo "[ OK  ] Command: clang"; } \
    || { echo "[ ERR ] Command: clang"; exit 1; }

if [ -d "${PROTOC_BASE_DIR}" ]; then
    rm -r ${PROTOC_BASE_DIR}
fi
mkdir -p ${PROTOC_BUILD_DIR} ${PROTOC_INSTALL_DIR}

cmake \
    -B${PROTOC_BUILD_DIR} \
    -GNinja \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_CXX_FLAGS=-std=c++17 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_INSTALL_PREFIX=${PROTOC_INSTALL_DIR} \
    -Dprotobuf_WITH_ZLIB=OFF \
    -Dprotobuf_BUILD_TESTS=OFF \
    -Dprotobuf_BUILD_CONFORMANCE=OFF \
    -Dprotobuf_BUILD_EXAMPLES=OFF \
    -Dprotobuf_BUILD_PROTOC_BINARIES=ON \
    -Dprotobuf_BUILD_SHARED_LIBS=OFF \
    "${PROTOBUF_DIR}/cmake"

ninja -C ${PROTOC_BUILD_DIR} install
