#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
BUILD_DIR="${PROJECT_ROOT}/app/build/release"

BUCKET_URL="s3://dashql-app"
DISTRIBUTION_ID="E1WT3LVZLA4YZX"

echo "Uploading files to ${BUCKET_URL}..."
aws s3 sync ${BUILD_DIR} ${BUCKET_URL}/ \
  --acl public-read \
  --delete

echo "Purging the cache for CloudFront"
aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths /
