#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

FLATC="${PROJECT_ROOT}/.flatc/install/bin/flatc"

TMP=$(mktemp -d)

${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

gen_proto() {
    PROTO_DIR="$1"
    CPP_PROTO_DIR="$2"
    TS_PROTO_DIR="$3"

    echo "${PROTO_DIR}"

    for PROTO_FILE in ${PROTO_DIR}/*.fbs; do
        PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
        PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"

        ${FLATC} -I ${PROTO_DIR} -o ${CPP_PROTO_DIR} ${PROTO_FILE} --cpp \
                --no-prefix --scoped-enums \
                --reflect-types --reflect-names \
                --gen-object-api --gen-name-strings --gen-compare \
            && { echo "[ OK  ] ${PROTO_FILE_NAME}: C++"; } \
            || { echo "[ ERR ] ${PROTO_FILE_NAME}: C++"; exit 1; }

        TS_PROTO_OUT="${TS_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
        TS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

        ${FLATC} -I ${TMP} -o ${TS_PROTO_DIR} ${PROTO_FILE} --ts \
                --no-fb-import \
                --reflect-types --reflect-names \
                --gen-name-strings --gen-compare \
            && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
            && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
            && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
            && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
            && { echo "[ OK  ] ${PROTO_FILE_NAME}: Typescript"; } \
            || { echo "[ ERR ] ${PROTO_FILE_NAME}: Typescript"; exit 1; }
    done
}

gen_proto "${PROJECT_ROOT}/core/proto" "${PROJECT_ROOT}/core/cpp/include/dashql/proto" "${PROJECT_ROOT}/core/js/src/proto"
gen_proto "${PROJECT_ROOT}/duckdb/proto" "${PROJECT_ROOT}/duckdb/cpp/include/duckdb/webapi/proto" "${PROJECT_ROOT}/duckdb/js/src/proto"

rm -r ${TMP}
