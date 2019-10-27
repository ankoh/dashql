#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
PROTO_SPEC_DIR="${PROTO_DIR}/spec"
CPP_PROTO_DIR="${PROTO_DIR}/lib/cpp/include/tigon/proto"
JS_PROTO_DIR="${PROTO_DIR}/lib/js/src/proto"

FLATC="${PROJECT_ROOT}/tigon-core/build/debug/third_party/flatc/install/bin/flatc"

${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

for PROTO_FILE in ${PROTO_SPEC_DIR}/*; do
    TMP=$(mktemp -d)

    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"
    PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.fbs"

    JS_PROTO_OUT="${JS_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    JS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    ${FLATC} -I ${PROTO_DIR} -o ${CPP_PROTO_DIR} ${PROTO_FILE} --cpp --no-prefix --scoped-enums \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    sed -e "s/^namespace.*$//g" ${PROTO_FILE} > ${PROTO_TMP} \
        && ${FLATC} -I ${PROTO_SPEC_DIR} -o ${JS_PROTO_DIR} ${PROTO_TMP} --ts --no-fb-import \
        && mv ${JS_PROTO_OUT} ${JS_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${JS_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${JS_PROTO_OUT} \
        && cat ${JS_PROTO_TMP} >> ${JS_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }

    rm -r ${PROTO_TMP}
done

