#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

CORE_SOURCE_DIR="${PROJECT_ROOT}/tigon-core"
CORE_BUILD_DIR="${PROJECT_ROOT}/tigon-core/build/emscripten"
APP_SOURCE_DIR="${PROJECT_ROOT}/tigon-app"
APP_LIB_DIR="${APP_SOURCE_DIR}/public/lib"

[ ! -z "${EMSDK}" ] \
    && { echo "[ OK  ] Test environment: EMSDK"; } \
    || { \
        echo "[ ERR ] Test environment: EMSDK"; \
        echo "You need to source emsdk_env.sh before running this script."; \
        exit 1; \
    }
[ -x "$(command -v emconfigure)" ] \
    && { echo "[ OK  ] Test command: emconfigure"; } \
    || { echo "[ ERR ] Test command: emconfigure"; exit 1; }
[ -x "$(command -v emmake)" ] \
    && { echo "[ OK  ] Test command: emmake"; } \
    || { echo "[ ERR ] Test command: emmake"; exit 1; }

mkdir -p ${CORE_BUILD_DIR}
cd ${CORE_BUILD_DIR}

emconfigure cmake ${CORE_SOURCE_DIR} \
    && { echo "[ OK  ] Build configuration"; } \
    || { echo "[ ERR ] Build configuration"; exit 1; }

emmake make -j$(nproc) tigon_web \
    && { echo "[ OK  ] Build project"; } \
    || { echo "[ ERR ] Build project"; exit 1; }

cp ${CORE_BUILD_DIR}/tigon_web.{wasm,js}  ${APP_LIB_DIR}

cd ${CORE_SOURCE_DIR}
