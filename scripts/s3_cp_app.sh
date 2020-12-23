#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

# -------------------------------------------------------------------------------------
# Upload the build to the S3 bucket.
#
# We deliberately do not sync with --delete here.
# A client may still see the old index.html while we're propagating the new one.
# This would result in broken apps until the caches pick up the new version.
#
# We instead plain copy the whole release archive independent of whether the files exist.
# This allows us to discover old versions quickly via the modification timestamps.
#
# We also rely on cache busting.
# All files in the static folder MUST include [contenthash] in the filename.
# That means that caches are never "stale" since an updated index.html will refer to new filenames.

S3_BUCKET="$1"
APP_RELEASE_ARCHIVE="$2"

# -------------------------------------------------------------------------------------
# Cache TTLs:
#   index.html 10 minutes
#   static     7 days
#

TTL_INDEX=600
TTL_STATIC=604800

# -------------------------------------------------------------------------------------
# CONFIG

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"
APP_DEPLOY_TMP_ARCHIVE="${ROOT_DIR}/artifacts/tmp/plain"
APP_DEPLOY_TMP_BROTLI="${ROOT_DIR}/artifacts/tmp/brotli"

BROTLI_LEVEL=11
BROTLI_FILE_MATCHERS=(
    "*.js"
    "*.css"
    "*.ttf"
    "*.wasm"
)
BROTLI_CONTENT_TYPES=(
    "application/javascript"
    "text/css"
    "font/ttf"
    "application/webassembly"
)

brotli --version 1>/dev/null \
    && { echo "[ OK   ] Command: brotli"; } \
    || { echo "[ ERR  ] Command: brotli"; exit 1; }

realpath --version 1>/dev/null \
    && { echo "[ OK   ] Command: realpath"; } \
    || { echo "[ ERR  ] Command: realpath"; exit 1; }

# -------------------------------------------------------------------------------------
# Prepare archive

rm -rf ${APP_DEPLOY_TMP}
mkdir -p ${APP_DEPLOY_TMP_ARCHIVE} ${APP_DEPLOY_TMP_BROTLI}

echo "Extracting tarball"
tar -C ${APP_DEPLOY_TMP_ARCHIVE} -xzf ${APP_RELEASE_ARCHIVE}

# -------------------------------------------------------------------------------------
# Compress files with brotli

echo "Compressing .js, .css, .ttf and .wasm with brotli"
find ${APP_DEPLOY_TMP_ARCHIVE} \
    -type f \( -iname "*.js" -o -iname "*.css" -o -iname "*.ttf"  -o -iname "*.wasm" \) \
    -exec sh -c "export OUT=${APP_DEPLOY_TMP_BROTLI}/\$(realpath --relative-to ${APP_DEPLOY_TMP_ARCHIVE} {}) && mkdir -p \$(dirname \${OUT}) && brotli --verbose --force --quality=${BROTLI_LEVEL} --output=\${OUT} {}" \; \

echo "Files"
rsync -av --ignore-existing ${APP_DEPLOY_TMP_ARCHIVE}/ ${APP_DEPLOY_TMP_BROTLI}/
find ${APP_DEPLOY_TMP_BROTLI} \
    -type f \
    -exec sh -c "du -hs {}" \; \

# -------------------------------------------------------------------------------------
# Copy compressed files to S3

for IDX in "${!BROTLI_FILE_MATCHERS[@]}"; do
    BROTLI_FILE_MATCHER=${BROTLI_FILE_MATCHERS[$IDX]}
    BROTLI_CONTENT_TYPE=${BROTLI_CONTENT_TYPES[$IDX]}

    echo "Copy ./static/${BROTLI_FILE_MATCHER} to S3"
    aws s3 cp "${APP_DEPLOY_TMP_BROTLI}/static" "${S3_BUCKET}/static" \
        --recursive \
        --exclude "*" \
        --include "${BROTLI_FILE_MATCHER}" \
        --content-type "${BROTLI_CONTENT_TYPE}" \
        --content-encoding "br" \
        --cache-control "max-age=${TTL_STATIC}" \
        --acl public-read
done

# -------------------------------------------------------------------------------------
# Copy uncompressed files to S3

echo "Copy ./static/ to S3"
aws s3 cp "${APP_DEPLOY_TMP_BROTLI}/static" "${S3_BUCKET}/static" \
    --recursive \
    --exclude "*.js" \
    --exclude "*.css" \
    --exclude "*.ttf" \
    --exclude "*.wasm" \
    --cache-control "max-age=${TTL_STATIC}" \
    --acl public-read

# -------------------------------------------------------------------------------------
# Copy index.html to S3

# We copy the new index.html at the end to hide the new build until everything is uploaded.

echo "Copy ./index.html to S3"
aws s3 cp "${APP_DEPLOY_TMP_BROTLI}/index.html" "${S3_BUCKET}/index.html" \
    --content-type "text/html" \
    --cache-control "max-age=${TTL_INDEX}" \
    --acl public-read
