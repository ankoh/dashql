#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

FLATC="flatc"
${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

SPEC_DIR="${PROJECT_ROOT}/packages/proto/spec/"
SPEC_INDEX="${SPEC_DIR}/proto.fbs"

OUT_DIR_CPP="${PROJECT_ROOT}/packages/proto/gen/cc/include/dashql"
OUT_DIR_TS="${PROJECT_ROOT}/packages/proto/gen/ts"

mkdir -p ${OUT_DIR_CPP} ${OUT_DIR_TS}

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_CPP} ${SPEC_INDEX} --cpp \
        --gen-all \
        --no-prefix --scoped-enums \
        --reflect-types --reflect-names \
        --gen-object-api --gen-name-strings --gen-compare \
        --gen-mutable \
    && { echo "[ OK  ] Generate C++ Library"; } \
    || { echo "[ ERR ] Generate C++ Library"; exit 1; }

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_TS} ${SPEC_INDEX} --ts \
        --gen-all \
        --reflect-types --reflect-names \
        --gen-name-strings --gen-compare \
        --gen-mutable \
    && { echo "[ OK  ] Generate Typescript Library"; } \
    || { echo "[ ERR ] Generate Typescript Library"; exit 1; }


TS_OUT_PROTO_BASE="${PROJECT_ROOT}/packages/proto/gen/ts/dashql/proto"
TS_OUT_PROTO_DIRS=`ls ${TS_OUT_PROTO_BASE}`
for PROTO_DIR in ${TS_OUT_PROTO_DIRS}; do
    PROTO_INDEX="${TS_OUT_PROTO_BASE}/${PROTO_DIR}/index.ts"
    echo "Generating $PROTO_INDEX"
    echo > ${PROTO_INDEX}
    PROTO_FILES=`ls ${TS_OUT_PROTO_BASE}/${PROTO_DIR}/*.ts`
    for PROTO_FILE in ${PROTO_FILES}; do
        IMPORT="$(basename $PROTO_FILE)"
        if [ "${IMPORT}" = "index.ts" ]; then continue; fi
        echo "export * from \"./${IMPORT%.*}\";" >> ${PROTO_INDEX}
    done
done
