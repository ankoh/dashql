#!/bin/bash

SERVER_DIR=${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache
REMOTE_HOST="root@bazel-cache.dashql.app"
REMOTE_DEST="/opt/dashql-bazel-cache/config"

set -x

# Start with the mandatory files
CONFIG_TARGETS=(
    "${SERVER_DIR}/docker-compose.yaml"
    "${SERVER_DIR}/bazel-remote.config.yaml"
)

# Only add certs if we generated certificates
if [ -d "${SERVER_DIR}/mtls" ]; then
    MTLS_TARGETS+=("${SERVER_DIR}/mtls/dashql-bazel-cache-ca.crt")
    MTLS_TARGETS+=("${SERVER_DIR}/mtls/dashql-bazel-cache-server.crt")
    MTLS_TARGETS+=("${SERVER_DIR}/mtls/dashql-bazel-cache-server.key")
fi

# Create the remote directories and set ownership for the data directory to 65532:65532
# https://github.com/buchgr/bazel-remote/blob/b857daf1f63c641dc3fe6105a674a6e9ed81cf35/docker/README.md?plain=1#L7
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DEST}/mtls /opt/dashql-bazel-cache/data && chown 65532:65532 /opt/dashql-bazel-cache/data"

# Execute rsync with the dynamic list
rsync -avz -e ssh "${CONFIG_TARGETS[@]}" "${REMOTE_HOST}:${REMOTE_DEST}/"
rsync -avz -e ssh "${MTLS_TARGETS[@]}" "${REMOTE_HOST}:${REMOTE_DEST}/mtls"

ssh "${REMOTE_HOST}" "chmod 644 ${REMOTE_DEST}/mtls/*.crt ${REMOTE_DEST}/mtls/*.key 2>/dev/null || true"
