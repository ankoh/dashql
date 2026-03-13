#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
SERVER_DIR=${SCRIPT_DIR}/../infra/bazel-cache-server

set -x

ssh dashql-bazel-cache "mkdir -p /opt/bazel-cache-server && touch /opt/bazel-cache-server/htpasswd"

touch ${SERVER_DIR}/docker-compose.env

scp \
    ${SERVER_DIR}/docker-compose.yaml \
    ${SERVER_DIR}/docker-compose.env \
    ${SERVER_DIR}/buildbuddy.config.yaml \
    ${SERVER_DIR}/nginx.conf \
    dashql-bazel-cache:/opt/bazel-cache-server/
