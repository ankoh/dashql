#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

EMSDK_COMMIT="1.40.1"
DOCKER_IMAGE_NAME="dashql-dev"
DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_TAG="${EMSDK_COMMIT}"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./dev/docker/dev/Dockerfile | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./dev/docker/dev/Dockerfile \
        --build-arg EMSDK_COMMIT="${EMSDK_COMMIT}" \
        -
