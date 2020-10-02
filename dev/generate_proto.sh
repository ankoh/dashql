#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/proto"
PROTO_SPEC_DIR="${PROTO_DIR}/spec"
CPP_PROTO_DIR="${PROTO_DIR}/lib/cpp/include/duckdb_webapi/proto"
RS_PROTO_DIR="${PROTO_DIR}/lib/rs/src/proto"
TS_PROTO_DIR="${PROTO_DIR}/lib/js/src/proto"

FLATC="${PROJECT_ROOT}/dev/flatc/install/bin/flatc"

TMP=$(mktemp -d)

${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

for PROTO_FILE in ${PROTO_SPEC_DIR}/*.fbs; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"

    ${FLATC} -I ${PROTO_DIR} -o ${CPP_PROTO_DIR} ${PROTO_FILE} --cpp \
            --no-prefix --scoped-enums \
            --reflect-types --reflect-names \
            --gen-object-api --gen-name-strings --gen-compare \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    ${FLATC} -I ${PROTO_DIR} -o ${RS_PROTO_DIR} ${PROTO_FILE} --rust \
            --reflect-types --reflect-names \
            --gen-object-api --gen-name-strings --gen-compare \
        && { echo "[ OK  ] ${PROTO_FILE}: Rust"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Rust"; exit 1; }
done

# Copy all flatbuffer specs without the namespace.
# We don't want namespaces in Typscript since we already have modules.
for PROTO_FILE in ${PROTO_SPEC_DIR}/*.fbs; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"

    FBS_TMP="${TMP}/${PROTO_FILE_NAME}.fbs"
    sed -e "s/^namespace.*$//g" ${PROTO_FILE} > ${FBS_TMP}
done

for PROTO_FILE in ${PROTO_SPEC_DIR}/*.fbs; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"
    FBS_TMP="${TMP}/${PROTO_FILE_NAME}.fbs"

    TS_PROTO_OUT="${TS_PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    TS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    ${FLATC} -I ${TMP} -o ${TS_PROTO_DIR} ${FBS_TMP} --ts --no-fb-import \
        && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
        && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }

done

rm -r ${TMP}

echo "[ RUN ] Bundle js library" \
    && cd "${PROTO_DIR}/lib/js" \
    && npm install --silent \
    && npm run build \
    && { echo "[ OK  ] Bundle js library"; } \
    || { echo "[ ERR ] Bundle js library"; exit 1; }

echo "[ RUN ] Install js library" \
    && cd "${PROJECT_ROOT}/libs/js" \
    && npm install --silent \
    && { echo "[ OK  ] Install js library"; } \
    || { echo "[ ERR ] Install js library"; exit 1; }
