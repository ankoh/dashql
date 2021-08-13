#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

trap exit SIGINT

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

MODE=${1:-Fast}
echo "MODE=${MODE}"

CPP_BUILD_DIR="${PROJECT_ROOT}/lib/build/wasm/${MODE}"
CPP_SOURCE_DIR="${PROJECT_ROOT}/lib"
ANALYZER_LIB_DIR="${PROJECT_ROOT}/packages/core/src/analyzer"
JMESPATH_LIB_DIR="${PROJECT_ROOT}/packages/core/src/jmespath"

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

ADDITIONAL_FLAGS=
case $MODE in
  "Debug") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=Debug -DWASM_FAST_LINKING=1" ;;
  "Fast") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=RelWithDebInfo -DWASM_FAST_LINKING=1" ;;
  "Release") ADDITIONAL_FLAGS="-DCMAKE_BUILD_TYPE=Release" ;;
   *) ;;
esac
echo "Build Type: ${MODE}"

mkdir -p ${CPP_SOURCE_DIR}/build/wasm/${MODE}
rm -f ${CPP_SOURCE_DIR}/build/wasm/${MODE}/analyzer_*.{wasm,js}
rm -f ${CPP_SOURCE_DIR}/build/wasm/${MODE}/jmespath_*.{wasm,js}

set -x

emcmake cmake \
    -S"${CPP_SOURCE_DIR}/" \
    -B"${CPP_SOURCE_DIR}/build/wasm/${MODE}" \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    ${ADDITIONAL_FLAGS}

emmake make \
    -C"${CPP_SOURCE_DIR}/build/wasm/${MODE}" \
    -j${CORES} \
    analyzer_wasm jmespath_wasm

cp ${CPP_SOURCE_DIR}/build/wasm/${MODE}/analyzer_*.{wasm,js} "${ANALYZER_LIB_DIR}"
cp ${CPP_SOURCE_DIR}/build/wasm/${MODE}/jmespath_*.{wasm,js} "${JMESPATH_LIB_DIR}"
