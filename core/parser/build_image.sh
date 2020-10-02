#!/bin/bash
set -euo pipefail

SOURCE_DIRECTORY="$(cd $(dirname "$BASH_SOURCE[0]") && pwd)" &> /dev/null

TOOLCHAIN_VERSION="$(cat ../rust-toolchain)"
DOCKER_IMAGE_NAME="dashql-parser"
DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_TAG="${TOOLCHAIN_VERSION}"

set -x

cd ${SOURCE_DIRECTORY} && \
    tar -cvf - ./Dockerfile | docker build \
        --tag ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        --build-arg TOOLCHAIN_VERSION="${TOOLCHAIN_VERSION}" \
        - \
    && docker tag ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:latest
