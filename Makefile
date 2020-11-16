ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

APP_RELEASE_DIR="${ROOT_DIR}/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"
APP_RELEASE_ARCHIVE="${ROOT_DIR}/artifacts/dashql-${APP_RELEASE_TAG}.tar.gz"
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"

CORE_SOURCE_DIR="${ROOT_DIR}/core/cpp"
CORE_DEBUG_DIR="${ROOT_DIR}/core/cpp/build/debug"

STABLE_S3_BUCKET="s3://dashql-app"
STABLE_CF_DIST="E1WT3LVZLA4YZX"

DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_NAME="dashql-dev"
DOCKER_IMAGE_TAG="0.2"

.PHONY: app_release
app_release:
	tar -C "./app/build/release" -cvzf ${APP_RELEASE_ARCHIVE} .
	@echo "Release: ${APP_RELEASE_ARCHIVE}"

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
	tar -C ${APP_DEPLOY_TMP} -xvzf ${APP_RELEASE_ARCHIVE}
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
	tar -C ${APP_DEPLOY_TMP} -xvzf ${APP_RELEASE_ARCHIVE}
	aws s3 sync "${APP_DEPLOY_TMP}/static" "${STABLE_S3_BUCKET}/static" \
		--cache-control "max-age=604800" \
		--acl public-read \
		--delete
	aws s3 sync ${APP_DEPLOY_TMP} ${STABLE_S3_BUCKET}/ \
		--exclude "static" \
		--cache-control "max-age=600" \
		--acl public-read

# You should never need this since we are using cache busting.
.PHONY: aws_stable_invalidate
aws_stable_invalidate:
	aws cloudfront create-invalidation \
		--distribution-id ${STABLE_CF_DIST} \
		--paths /

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands:
	ln -sf ${CORE_DEBUG_DIR}/compile_commands.json ${ROOT_DIR}/compile_commands.json

# Reset the duckdb repo
.PHONY: reset_duckdb
reset_duckdb:
	rm -rf ${ROOT_DIR}/submodules/duckdb/src/amalgamation/*
	rm -rf ${ROOT_DIR}/submodules/duckdb/build/*

# Clean the repository
.PHONY: clean
clean:
	git clean -xfd
	git submodule foreach --recursive git clean -xfd
	git reset --hard
	git submodule foreach --recursive git reset --hard
	git submodule update --init --recursive

# Build the dev image
.PHONY: image
image:
	tar -cvf - ./scripts/Dockerfile.dev | docker build \
		-t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
		-f ./scripts/Dockerfile.dev \
		-
