#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

EMSDK_VERSION="2.0.4"
DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_NAME="emsdk"
DOCKER_IMAGE_TAG="0.1"

set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./dev/Dockerfile.emsdk | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./dev/Dockerfile.emsdk \
        --build-arg EMSDK_VERSION="${EMSDK_VERSION}" \
        -

