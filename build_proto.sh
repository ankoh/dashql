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
    TMP=$(mktemp -d)
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"
    PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.fbs"
    APP_PROTO_OUT="${APP_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    APP_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    flatc -I ${PROTO_DIR} -o ${CORE_PROTO_DIR} ${PROTO_FILE} --cpp --no-prefix --scoped-enums \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    sed -e "s/^namespace.*$//g" ${PROTO_FILE} > ${PROTO_TMP} \
        && flatc -I ${PROTO_DIR} -o ${APP_PROTO_DIR} ${PROTO_TMP} --ts --no-fb-import \
        && mv ${APP_PROTO_OUT} ${APP_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${APP_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${APP_PROTO_OUT} \
        && cat ${APP_PROTO_TMP} >> ${APP_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }

    rm -r ${PROTO_TMP}
done
