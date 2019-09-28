#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/.."

DOCKER_FILE=/tigon/tigon-package/Dockerfile
DOCKER_IMAGE_NAME=tigon
DOCKER_IMAGE_NAMESPACE=ankoh
DOCKER_IMAGE_TAG=latest

set -x

tar -cvf - ./tigon-app/build ./tigon-package | docker build \
    -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
    -f ./tigon-package/Dockerfile \
    -
