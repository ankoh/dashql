#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/proto"
CPP_PROTO_DIR="${PROJECT_ROOT}/core/cpp/include/dashql/proto"
TS_PROTO_DIR="${PROJECT_ROOT}/core/js/src/proto"

FLATC="${PROJECT_ROOT}/scripts/flatc/install/bin/flatc"

TMP=$(mktemp -d)

${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

# Generate C++
for PROTO_FILE in ${PROTO_DIR}/dashql_core/*.fbs; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"

    if [ "${PROTO_FILE_NAME}" = "proto" ]; then
        continue
    fi

    ${FLATC} -I ${PROTO_DIR} -o ${CPP_PROTO_DIR} ${PROTO_FILE} --cpp \
            --no-prefix --scoped-enums \
            --reflect-types --reflect-names \
            --gen-object-api --gen-name-strings --gen-compare \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    TS_PROTO_OUT="${TS_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    TS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    ${FLATC} -I ${TMP} -o ${TS_PROTO_DIR} ${PROTO_FILE} --ts --no-fb-import \
        && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
        && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }
done

rm -r ${TMP}
