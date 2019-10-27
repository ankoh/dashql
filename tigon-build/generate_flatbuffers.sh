#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
PROTO_SPEC_DIR="${PROTO_DIR}/spec"
CPP_PROTO_DIR="${PROTO_DIR}/lib/cpp/include/tigon/proto"
TS_PROTO_DIR="${PROTO_DIR}/lib/ts/src/proto"

[ -x "$(command -v flatc)" ] \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

for PROTO_FILE in ${PROTO_SPEC_DIR}/*; do
    TMP=$(mktemp -d)

    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"
    PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.fbs"

    TS_PROTO_OUT="${TS_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    TS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    flatc -I ${PROTO_DIR} -o ${CPP_PROTO_DIR} ${PROTO_FILE} --cpp --no-prefix --scoped-enums \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    sed -e "s/^namespace.*$//g" ${PROTO_FILE} > ${PROTO_TMP} \
        && flatc -I ${PROTO_SPEC_DIR} -o ${TS_PROTO_DIR} ${PROTO_TMP} --ts --no-fb-import \
        && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
        && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }

    rm -r ${PROTO_TMP}
done

