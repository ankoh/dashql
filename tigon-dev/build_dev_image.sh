#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

DOCKER_IMAGE_NAME="tigon-dev"
DOCKER_IMAGE_NAMESPACE="ankoh"
DOCKER_IMAGE_TAG="latest"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./tigon-dev/docker/Dockerfile.dev | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./tigon-dev/docker/Dockerfile.dev \
        -
