#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
PROTO_SPEC_DIR="${PROTO_DIR}/spec"
PROTO_BUILD_DIR="${PROTO_DIR}/build"
PROTOC="${PROJECT_ROOT}/tigon-core/build/debug/third_party/protoc/install/bin/protoc"

TSPROTOC_BUILD_DIR="${PROTO_BUILD_DIR}/ts-protoc-gen/"
TSPROTOC_PLUGIN="${TSPROTOC_BUILD_DIR}/node_modules/.bin/protoc-gen-ts"

CPP_PROTO_DIR="${PROTO_DIR}/lib/cpp/include/tigon/proto"
JS_PROTO_DIR="${PROTO_DIR}/lib/js/src/proto"

${PROTOC} --version \
    && { echo "[ OK  ] Command: protoc"; } \
    || { echo "[ ERR ] Command: protoc"; exit 1; }

if [ -x "$(command -v ${TSPROTOC_PLUGIN})" ]; then
    echo "[ OK  ] Command: protoc-gen-ts"
else
    echo "[ GEN ] Command: protoc-gen-ts"
    mkdir -p ${TSPROTOC_BUILD_DIR} \
        && cd ${TSPROTOC_BUILD_DIR} \
        && npm install ts-protoc-gen@next \
        && { echo "[ OK  ] Command: protoc-gen-ts"; } \
        || { echo "[ ERR ] Command: protoc-gen-ts"; exit 1; }
fi

for PROTO_FILE in ${PROTO_SPEC_DIR}/*; do
    ${PROTOC} \
        -I ${PROTO_SPEC_DIR} \
        --plugin=protoc-gen-ts=${TSPROTOC_PLUGIN} \
        --cpp_out=${CPP_PROTO_DIR} \
        --js_out=${JS_PROTO_DIR} \
        --ts_out=${JS_PROTO_DIR} \
        ${PROTO_FILE} \
        && { echo "[ OK  ] ${PROTO_FILE}"; } \
        || { echo "[ ERR ] ${PROTO_FILE}"; exit 1; }
done

