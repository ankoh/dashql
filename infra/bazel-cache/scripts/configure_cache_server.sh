#!/bin/bash

SERVER_DIR=${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache
REMOTE_HOST="root@bazel-cache.dashql.app"
REMOTE_DEST="/opt/dashql-bazel-cache/config"

set -x

touch "${SERVER_DIR}/docker-compose.env"

# Start with the mandatory files
SYNC_TARGETS=(
    "${SERVER_DIR}/docker-compose.yaml"
    "${SERVER_DIR}/docker-compose.env"
    "${SERVER_DIR}/bazel-remote.config.yaml"
    "${SERVER_DIR}/prometheus.yml"
    "${SERVER_DIR}/Caddyfile"
)

# Only add certs if we generated certificates
if [ -d "${SERVER_DIR}/mtls" ]; then
    SYNC_TARGETS+=("${SERVER_DIR}/mtls")
fi

# Create the remote directories and set ownership for the data directory to 65532:65532
# https://github.com/buchgr/bazel-remote/blob/b857daf1f63c641dc3fe6105a674a6e9ed81cf35/docker/README.md?plain=1#L7
# prom/prometheus:v3-distroless runs as nonroot (65532) inside the container
ssh "${REMOTE_HOST}" bash <<EOF
set -e
mkdir -p \
    ${REMOTE_DEST}/mtls \
    /opt/dashql-bazel-cache/data/bazel-remote \
    /opt/dashql-bazel-cache/data/prometheus \
    /opt/dashql-bazel-cache/data/grafana \
    /opt/dashql-bazel-cache/data/caddy-data \
    /opt/dashql-bazel-cache/data/caddy-config
chown 65532:65532 /opt/dashql-bazel-cache/data/bazel-remote
chown 65532:65532 /opt/dashql-bazel-cache/data/prometheus
chown 472:472     /opt/dashql-bazel-cache/data/grafana
EOF

rsync -avz -e ssh "${SYNC_TARGETS[@]}" "${REMOTE_HOST}:${REMOTE_DEST}/"

ssh "${REMOTE_HOST}" "chmod 644 ${REMOTE_DEST}/mtls/*.crt ${REMOTE_DEST}/mtls/*.key 2>/dev/null || true"
