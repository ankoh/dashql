#!/usr/bin/env bash
# Copyright (c) 2022 The DashQL Authors

set -euo pipefail

trap exit SIGINT

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

MODE=${1:-Fast}
echo "MODE=${MODE}"

CPP_BUILD_DIR="${PROJECT_ROOT}/libs/dashql-parser/build/wasm/${MODE}"
CPP_SOURCE_DIR="${PROJECT_ROOT}/libs/dashql-parser"

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

ADDITIONAL_FLAGS=
case $MODE in
  "Debug") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=Debug" ;;
  "Fast") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=RelWithDebInfo" ;;
  "Release") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=Release" ;;
   *) ;;
esac
echo "BUILD_TYPE=${MODE}"
echo "WASI_SDK_PREFIX=${WASI_SDK_PREFIX}"
echo "WASI_TOOLCHAIN=${WASI_CMAKE_TOOLCHAIN}"

mkdir -p ${CPP_SOURCE_DIR}/build/wasm/${MODE}

set -x
cmake \
    -S"${CPP_SOURCE_DIR}/" \
    -B"${CPP_SOURCE_DIR}/build/wasm/${MODE}" \
    -DWASI_SDK_PREFIX=${WASI_SDK_PREFIX} \
    -DCMAKE_SYSROOT=${WASI_SYSROOT} \
    -DCMAKE_TOOLCHAIN_FILE=${WASI_CMAKE_TOOLCHAIN} \
    -DWASM=1 \
    ${ADDITIONAL_FLAGS}

make \
    -C"${CPP_SOURCE_DIR}/build/wasm/${MODE}" \
    -j${CORES} \
    dashql_parser
