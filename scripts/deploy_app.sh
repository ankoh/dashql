#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
BUILD_DIR="${PROJECT_ROOT}/app/build/release"

BUCKET_URL="s3://dashql-app"
DISTRIBUTION_ID="E1WT3LVZLA4YZX"

echo "Uploading files to ${BUCKET_URL}..."
aws s3 sync ${BUILD_DIR} ${BUCKET_URL}/ \
  --acl public-read \
  --exclude index.html

# echo "Uploading service-worker.js"
# aws s3 cp build/service-worker.js ${S3_BUCKET}/service-worker.js \
#   --metadata-directive REPLACE \
#   --cache-control max-age=0,no-cache,no-store,must-revalidate \
#   --content-type application/javascript \
#   --acl public-read

echo "Uploading index.html"
aws s3 cp ${BUILD_DIR}/index.html ${BUCKET_URL}/index.html \
  --metadata-directive REPLACE \
  --cache-control max-age=0,no-cache,no-store,must-revalidate \
  --content-type text/html \
  --acl public-read

echo "Purging the cache for CloudFront"
aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths /
