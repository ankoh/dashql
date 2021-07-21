#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

EMSDK_VERSION="2.0.25"
EMSDK_RELEASE="https://github.com/emscripten-core/emsdk/archive/refs/tags/${EMSDK_VERSION}.tar.gz"
EMSDK_DIR=${PROJECT_ROOT}/.tmp/emsdk

rm -rf ${EMSDK_DIR}
mkdir -p ${EMSDK_DIR}

set -x

echo "[ RUN ] Load emsdk"
cd ${PROJECT_ROOT}
curl -L -o ${EMSDK_DIR}/emsdk.tar.gz "${EMSDK_RELEASE}"

echo "[ RUN ] Extract emsdk"
cd ${EMSDK_DIR}
tar -xvzf ${EMSDK_DIR}/emsdk.tar.gz --strip-components=1

echo "[ RUN ] Install emsdk"
./emsdk install "${EMSDK_VERSION}"

echo "[ RUN ] Activate emsdk"
./emsdk activate "${EMSDK_VERSION}"
