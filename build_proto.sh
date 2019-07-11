#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
CORE_SOURCE_DIR="${PROJECT_ROOT}/tigon-core"
CORE_PROTO_DIR="${CORE_SOURCE_DIR}/include/tigon/proto"
APP_SOURCE_DIR="${PROJECT_ROOT}/tigon-app"
APP_PROTO_DIR="${APP_SOURCE_DIR}/src/proto"

[ -x "$(command -v flatc)" ] \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

PROTO_FILES=( \
    ${PROTO_DIR}/web_api.fbs \
)

for PROTO_FILE in ${PROTO_FILES}; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"
    APP_PROTO_OUT="${APP_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    APP_PROTO_TMP="${APP_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts.tmp"

    flatc -I ${PROTO_DIR} -o ${CORE_PROTO_DIR} ${PROTO_FILE} --cpp --no-prefix --scoped-enums \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    flatc -I ${PROTO_DIR} -o ${APP_PROTO_DIR} ${PROTO_FILE} --ts --no-fb-import \
        && mv ${APP_PROTO_OUT} ${APP_PROTO_TMP} \
        && echo "import { flatbuffers } from \"flatbuffers\";" > ${APP_PROTO_OUT} \
        && cat ${APP_PROTO_TMP} >> ${APP_PROTO_OUT} \
        && rm ${APP_PROTO_TMP} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }
done
