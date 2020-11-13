#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/core/src/proto"
PROTO_AMALGAMATION_FILE="${PROTO_DIR}/proto.fbs"

FLATC="${PROJECT_ROOT}/dev/flatc/install/bin/flatc"

TMP=$(mktemp -d)

${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

# Generate Rust
${FLATC} -I ${PROTO_DIR} -o ${PROTO_DIR} ${PROTO_AMALGAMATION_FILE} --rust \
        --reflect-types --reflect-names \
        --gen-all \
        --gen-mutable \
        --gen-object-api --gen-name-strings --gen-compare \
    && { echo "[ OK  ] ${PROTO_AMALGAMATION_FILE}: Rust"; } \
    || { echo "[ ERR ] ${PROTO_AMALGAMATION_FILE}: Rust"; exit 1; }

# Generate TypeScript
for PROTO_FILE in ${PROTO_DIR}/*.fbs; do
    PROTO_FILE_NAME=$(basename -- "${PROTO_FILE}")
    PROTO_FILE_NAME="${PROTO_FILE_NAME%.*}"

    if [ "${PROTO_FILE_NAME}" = "proto" ]; then
        continue
    fi

    TS_PROTO_OUT="${PROTO_DIR}/${PROTO_FILE_NAME}_generated.ts"
    TS_PROTO_TMP="${TMP}/${PROTO_FILE_NAME}.ts"

    ${FLATC} -I ${TMP} -o ${PROTO_DIR} ${PROTO_FILE} --ts --no-fb-import \
        && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
        && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
        && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
        && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
        && { echo "[ OK  ] ${PROTO_FILE}: Typescript"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: Typescript"; exit 1; }
done

rm -r ${TMP}
