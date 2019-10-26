#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

PROTO_DIR="${PROJECT_ROOT}/tigon-proto"
PROTO_MODEL_DIR="${PROTO_DIR}/model"
PROTO_CPP_LIB_DIR="${PROTO_DIR}/lib/cpp"
PROTO_CPP_OUT_DIR="${PROTO_CPP_LIB_DIR}/include/tigon/proto"
PROTO_JS_LIB_DIR="${PROTO_DIR}/lib/js"
PROTO_JS_OUT_DIR="${PROTO_JS_LIB_DIR}/src"

[ -x "$(command -v fbec)" ] \
    && { echo "[ OK  ] Command: fbec"; } \
    || { echo "[ ERR ] Command: fbec"; exit 1; }

rm ${PROTO_CPP_OUT_DIR}/*
rm ${PROTO_JS_OUT_DIR}/*

for PROTO_FILE in ${PROTO_MODEL_DIR}/*.fbe; do
    fbec -q --cpp \
        --input=${PROTO_FILE} \
        --output=${PROTO_CPP_OUT_DIR} \
        && { echo "[ OK  ] ${PROTO_FILE}: C++"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: C++"; exit 1; }

    fbec -q --javascript \
        --input=${PROTO_FILE} \
        --output=${PROTO_JS_OUT_DIR} \
        && { echo "[ OK  ] ${PROTO_FILE}: JS"; } \
        || { echo "[ ERR ] ${PROTO_FILE}: JS"; exit 1; }
done
