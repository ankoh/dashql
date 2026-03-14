#!/usr/bin/env bash
set -euo pipefail

MTLS_DIR="${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache/mtls"

echo "BAZEL_CACHE_MTLS_CA:"
base64 -i "${MTLS_DIR}/dashql-bazel-cache-ca.crt" | tr -d '\n'
echo ""
echo ""

echo "BAZEL_CACHE_MTLS_CLIENT_CERT:"
base64 -i "${MTLS_DIR}/dashql-bazel-cache-client.crt" | tr -d '\n'
echo ""
echo ""

echo "BAZEL_CACHE_MTLS_CLIENT_KEY:"
base64 -i "${MTLS_DIR}/dashql-bazel-cache-client.key" | tr -d '\n'
echo ""
