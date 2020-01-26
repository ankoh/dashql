#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

EMSDK_COMMIT="a5082b2"
DOCKER_IMAGE_NAME="tigon-dev"
DOCKER_IMAGE_NAMESPACE="ankoh"
DOCKER_IMAGE_TAG="${EMSDK_COMMIT}"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./tigon-dev/docker/dev/Dockerfile | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./tigon-dev/docker/dev/Dockerfile \
        --build-arg EMSDK_COMMIT="${EMSDK_COMMIT}" \
        -
