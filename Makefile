APP_RELEASE_DIR="${PROJECT_ROOT}/app/build/release"

STABLE_S3_BUCKET="s3://dashql-app"
STABLE_CF_DIST="E1WT3LVZLA4YZX"
GIT_COMMIT_SHORT="$(shell git rev-parse --short HEAD)"
APP_RELEASE_FILE="./artifacts/dashql-${GIT_COMMIT_SHORT}.tar.gz"
APP_DEPLOY_TMP="./artifacts/tmp"

.PHONY: app_release
app_release:
	tar -C "./app/build/release" -cvzf ${APP_RELEASE_FILE} .
	@echo "Release: ${APP_RELEASE_FILE}"

# We deliberately do not sync with --delete here.
# A client may still see the old index.html while we're propagating the new one.
# This would result in broken apps until the caches pick up the new version.
#
# We also rely on cache busting.
# All files in the static folder MUST include [contenthash] in the filename.
# That means that caches are never "stale" since an updated index.html will refer to new filenames if they changed.
#
# Cache TTLs:
#   index.html 10 minutes
#   static     7 days
# 
.PHONY: aws_stable_deploy
aws_stable_deploy:
	rm -rf ${APP_DEPLOY_TMP} && mkdir -p ${APP_DEPLOY_TMP}
	tar -C ${APP_DEPLOY_TMP} -xvzf ${APP_RELEASE_FILE}
	aws s3 sync "${APP_DEPLOY_TMP}/static" "${STABLE_S3_BUCKET}/static" \
		--cache-control "max-age=604800" \
		--acl public-read
	aws s3 sync ${APP_DEPLOY_TMP} ${STABLE_S3_BUCKET}/ \
		--exclude "static" \
		--cache-control "max-age=600" \
		--acl public-read

# Use this with care to cleanup old S3 files.
#
# This will remove old webpack chunks that cached index.html files might still refer to.
# You have to wait at least the max-age of the index.html before you can sync with --delete.
# Better run this command rarely and 1 day after running aws_stable_deploy on the same version.
#
.PHONY: aws_stable_replace
aws_stable_replace:
	rm -rf ${APP_DEPLOY_TMP} && mkdir -p ${APP_DEPLOY_TMP}
	tar -C ${APP_DEPLOY_TMP} -xvzf ${APP_RELEASE_FILE}
	aws s3 sync "${APP_DEPLOY_TMP}/static" "${STABLE_S3_BUCKET}/static" \
		--cache-control "max-age=604800" \
		--acl public-read \
		--delete
	aws s3 sync ${APP_DEPLOY_TMP} ${STABLE_S3_BUCKET}/ \
		--exclude "static" \
		--cache-control "max-age=600" \
		--acl public-read

# You should never need this since we are using cache busting.
aws_stable_invalidate:
	aws cloudfront create-invalidation \
		--distribution-id ${STABLE_CF_DIST} \
		--paths /
