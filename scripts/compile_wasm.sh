#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

trap exit SIGINT

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

BUILD_TYPE=${1:-Release}
echo "BUILD_TYPE=${BUILD_TYPE}"

CPP_BUILD_DIR="${PROJECT_ROOT}/lib/build/wasm/${BUILD_TYPE}"
CPP_SOURCE_DIR="${PROJECT_ROOT}/lib"
DATAFRAME_LIB_DIR="${PROJECT_ROOT}/core/src/dataframe"
ANALYZER_LIB_DIR="${PROJECT_ROOT}/core/src/analyzer"
WEBDB_LIB_DIR="${PROJECT_ROOT}/webdb/src/"
set -x

mkdir -p ${CPP_BUILD_DIR}

CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

mkdir -p ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}
rm -f ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/*.{wasm,js}

emcmake cmake \
    -S"${CPP_SOURCE_DIR}/" \
    -B"${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}" \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"

emmake make \
    -C"${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}" \
    -j${CORES} \
    dataframe_wasm dataframe_wasm_node analyzer_wasm analyzer_wasm_node webdb_wasm webdb_wasm_node

cp ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/dataframe_*.{wasm,js} "${DATAFRAME_LIB_DIR}"
cp ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/analyzer_*.{wasm,js} "${ANALYZER_LIB_DIR}"
cp ${CPP_SOURCE_DIR}/build/wasm/${BUILD_TYPE}/webdb_*.{wasm,js} "${WEBDB_LIB_DIR}"
