#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_NAME="dashql-dev"
DOCKER_IMAGE_TAG="0.2"
set -x

cd ${PROJECT_ROOT} && \
    tar -cvf - ./dev/docker/dev/Dockerfile | docker build \
        -t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
        -f ./dev/docker/dev/Dockerfile \
        -


