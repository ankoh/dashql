#!/bin/bash

SERVER_DIR=${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache
REMOTE_HOST="root@buildbuddy.dashql.app"
REMOTE_DEST="/opt/dashql-bazel-cache"

set -x

# Ensure the environment file exists locally before syncing
touch "${SERVER_DIR}/docker-compose.env"

# Start with the mandatory files
SYNC_TARGETS=(
    "${SERVER_DIR}/docker-compose.yaml"
    "${SERVER_DIR}/docker-compose.env"
    "${SERVER_DIR}/buildbuddy.config.yaml"
    "${SERVER_DIR}/nginx.conf"
)

# Only add certs if we generated certificates
if [ -d "${SERVER_DIR}/mtls" ]; then
    SYNC_TARGETS+=("${SERVER_DIR}/mtls")
fi

# Create the remote config directory
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DEST}"

# Execute rsync with the dynamic list
rsync -avz -e ssh "${SYNC_TARGETS[@]}" "${REMOTE_HOST}:${REMOTE_DEST}/"
