#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
PROTO_SPEC_DIR="${PROTO_DIR}/spec"
CPP_PROTO_DIR="${PROTO_DIR}/lib/cpp/include/tigon/proto"
JS_PROTO_DIR="${PROTO_DIR}/lib/js/src/proto"

NANOPB_SOURCE_DIR="${PROJECT_ROOT}/submodules/nanopb"
NANOPB_INCLUDE_DIR="${NANOPB_SOURCE_DIR}/generator/proto"
NANOPB_PLUGIN="${NANOPB_SOURCE_DIR}/generator/protoc-gen-nanopb"

PROTOC="protoc"

${PROTOC} --version \
    && { echo "[ OK  ] Command: protoc"; } \
    || { echo "[ ERR ] Command: protoc"; exit 1; }

for PROTO_FILE in ${PROTO_SPEC_DIR}/*; do
    ${PROTOC} \
        -I ${PROTO_SPEC_DIR} \
        -I ${NANOPB_INCLUDE_DIR} \
            --plugin=protoc-gen-nanopb=${NANOPB_PLUGIN} \
            --nanopb_out=${CPP_PROTO_DIR} \
            ${PROTO_FILE} \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

done

