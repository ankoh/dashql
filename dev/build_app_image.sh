#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

DOCKER_IMAGE_NAME="tigon"
DOCKER_IMAGE_NAMESPACE="tigon"
DOCKER_IMAGE_TAG="latest"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./app/build ./dev/docker/app | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./dev/docker/app/Dockerfile \
        -
