#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

FLATC="flatc"
${FLATC} --version \
    && { echo "[ OK  ] Command: flatc"; } \
    || { echo "[ ERR ] Command: flatc"; exit 1; }

TMP=$(mktemp -d)

SPEC_DIR="${PROJECT_ROOT}/packages/proto/spec/"
SPEC_INDEX="${SPEC_DIR}/proto.fbs"

OUT_DIR_RS="${PROJECT_ROOT}/packages/proto/gen"
OUT_DIR_CPP="${PROJECT_ROOT}/packages/proto/gen/include/dashql"
OUT_DIR_JS="${PROJECT_ROOT}/packages/proto/gen"

mkdir -p ${OUT_DIR_RS} ${OUT_DIR_CPP} ${OUT_DIR_JS}

# ${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_RS} ${SPEC_INDEX} --rust \
#         --gen-all \
#         --reflect-types --reflect-names \
#         --gen-object-api --gen-name-strings --gen-compare \
#         --gen-mutable \
#     && { echo "[ OK  ] Generate Rust Library"; } \
#     || { echo "[ ERR ] Generate Rust Library"; exit 1; }

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_CPP} ${SPEC_INDEX} --cpp \
        --gen-all \
        --no-prefix --scoped-enums \
        --reflect-types --reflect-names \
        --gen-object-api --gen-name-strings --gen-compare \
        --gen-mutable \
    && { echo "[ OK  ] Generate C++ Library"; } \
    || { echo "[ ERR ] Generate C++ Library"; exit 1; }

TS_PROTO_OUT="${OUT_DIR_JS}/proto_generated.ts"
TS_PROTO_TMP="${TMP}/proto_generated.ts"

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_JS} ${SPEC_INDEX} --ts \
        --gen-all \
        --no-fb-import \
        --reflect-types --reflect-names \
        --gen-name-strings --gen-compare --short-names \
        --gen-mutable \
    && mv ${TS_PROTO_OUT} ${TS_PROTO_TMP} \
    && echo "/* eslint-disable */" > ${TS_PROTO_OUT} \
    && echo "import { flatbuffers } from \"flatbuffers\";" >> ${TS_PROTO_OUT} \
    && cat ${TS_PROTO_TMP} >> ${TS_PROTO_OUT} \
    && { echo "[ OK  ] Generate Typescript Library"; } \
    || { echo "[ ERR ] Generate Typescript Library"; exit 1; }

rm -r ${TMP}
