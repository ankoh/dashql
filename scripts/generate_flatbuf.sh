#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

FLATC=${FLATC:-"./.infra/unpacked/flatc/flatc"}
if ! [ -x "$(command -v ${FLATC})" ]; then
    FLATC="flatc"
fi
${FLATC} --version &&
    { echo "[ OK  ] Command: flatc"; } ||
    {
        echo "[ ERR ] Command: flatc"
        exit 1
    }

SPEC_DIR="${PROJECT_ROOT}/proto/fb/"
SPEC_INDEX="${SPEC_DIR}/dashql/index.fbs"

OUT_DIR_CPP="${PROJECT_ROOT}/packages/dashql-core/include/dashql/buffers"
OUT_DIR_TS="${PROJECT_ROOT}/packages/dashql-core-api/gen"

rm -rf ${OUT_DIR_CPP}/*
rm -rf ${OUT_DIR_TS}/*
mkdir -p ${OUT_DIR_CPP} ${OUT_DIR_TS}

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_CPP} ${SPEC_INDEX} --cpp \
    --gen-all \
    --no-prefix --scoped-enums \
    --reflect-types --reflect-names \
    --gen-object-api --gen-name-strings --gen-compare \
    --gen-mutable &&
    { echo "[ OK  ] Generate C++ Library"; } ||
    {
        echo "[ ERR ] Generate C++ Library"
        exit 1
    }

${FLATC} -I ${SPEC_DIR} -o ${OUT_DIR_TS} ${SPEC_INDEX} --ts \
    --gen-all \
    --reflect-types --reflect-names \
    --gen-name-strings --gen-compare \
    --gen-mutable \
    --gen-object-api &&
    { echo "[ OK  ] Generate Typescript Library"; } ||
    {
        echo "[ ERR ] Generate Typescript Library"
        exit 1
    }

TS_OUT_PROTO_BASE="${OUT_DIR_TS}/dashql/buffers"
TS_OUT_PROTO_DIRS=$(ls ${TS_OUT_PROTO_BASE}/)
TS_OUT_PROTO_IDX="${TS_OUT_PROTO_BASE}/../buffers.ts"
if [ -f ${TS_OUT_PROTO_IDX} ]; then
    rm ${TS_OUT_PROTO_IDX}
fi

# Necessary because flatc is buggy for namespaces with depth > 1:
# https://github.com/google/flatbuffers/issues/7898

PROTO_DIRS=$(ls -d ${TS_OUT_PROTO_BASE}/*/)
for PROTO_SUBDIR_PATH in ${PROTO_DIRS}; do
    PROTO_DIRNAME="$(basename $PROTO_SUBDIR_PATH)"
    PROTO_SUBDIR="${TS_OUT_PROTO_BASE}/${PROTO_DIRNAME}"

    PROTO_INDEX="${TS_OUT_PROTO_BASE}/${PROTO_DIRNAME}.ts"
    echo "Generating $PROTO_INDEX"
    echo >${PROTO_INDEX}

    PROTO_FILES=$(ls ${PROTO_SUBDIR}/*.ts)
    for PROTO_FILE in ${PROTO_FILES}; do
        PROTO_FILENAME="$(basename $PROTO_FILE)"
        echo "export * from \"./${PROTO_DIRNAME}/${PROTO_FILENAME%.*}.js\";" >>${PROTO_INDEX}
    done
done
