#!/usr/bin/env bash
set -euo pipefail

MTLS_DIR="${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache/mtls"

echo "BAZEL_CACHE_RESULTS_URL:"
echo "https://buildbuddy.dashql.app/invocation/"
echo ""

echo "BAZEL_CACHE_BES_BACKEND:"
echo "grpcs://buildbuddy.dashql.app:1986"
echo ""

echo "BAZEL_CACHE_ENDPOINT:"
echo "grpcs://buildbuddy.dashql.app:1986"
echo ""

echo "BAZEL_CACHE_MTLS_CA:"
base64 -i "${MTLS_DIR}/dashql-cache-ca.crt" | tr -d '\n'
echo ""
echo ""

echo "BAZEL_CACHE_MTLS_CLIENT_CERT:"
base64 -i "${MTLS_DIR}/dashql-cache-client.crt" | tr -d '\n'
echo ""
echo ""

echo "BAZEL_CACHE_MTLS_CLIENT_KEY:"
base64 -i "${MTLS_DIR}/dashql-cache-client.key" | tr -d '\n'
echo ""
