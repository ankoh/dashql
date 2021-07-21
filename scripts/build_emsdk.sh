#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

EMSDK_VERSION="2.0.25"
EMSDK_RELEASE="https://github.com/emscripten-core/emsdk/archive/refs/tags/${EMSDK_VERSION}.tar.gz"
EMSDK_DIR=${PROJECT_ROOT}/.emsdk

rm -rf ${EMSDK_DIR}
mkdir -p ${EMSDK_DIR}/emsdk

set -x

echo "[ RUN ] Build emsdk"

cd ${PROJECT_ROOT}
curl -L -o ${EMSDK_DIR}/emsdk.tar.gz "${EMSDK_RELEASE}"

cd ${EMSDK_DIR}
tar -xvzf ${EMSDK_DIR}/emsdk.tar.gz --strip-components=1
