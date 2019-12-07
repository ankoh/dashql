#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

DOCKER_IMAGE_NAME="tigon"
DOCKER_IMAGE_NAMESPACE="ankoh"
DOCKER_IMAGE_TAG="latest"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./tigon-app/build ./tigon-build/docker/Dockerfile.app | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./tigon-build/docker/Dockerfile.app \
        -
