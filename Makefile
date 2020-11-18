# Copyright (c) 2020 The DashQL Authors

# ---------------------------------------------------------------------------
# Config

ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

APP_RELEASE_DIR="${ROOT_DIR}/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"
APP_RELEASE_ARCHIVE="${ROOT_DIR}/artifacts/dashql-${APP_RELEASE_TAG}.tar.gz"
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"

CORE_SOURCE_DIR="${ROOT_DIR}/core/cpp"
CORE_DEBUG_DIR="${ROOT_DIR}/core/cpp/build/debug"
CORE_RELEASE_DIR="${ROOT_DIR}/core/cpp/build/release"

DOCKER_IMAGE_NAMESPACE="dashql"
DOCKER_IMAGE_NAME="ci"
DOCKER_IMAGE_TAG="0.2"

FLATBUF_DIR="${ROOT_DIR}/submodules/flatbuffers"
FLATC_BASE_DIR="${ROOT_DIR}/.flatc"
FLATC_BUILD_DIR="${FLATC_BASE_DIR}/build"
FLATC_INSTALL_DIR="${FLATC_BASE_DIR}/install"

STABLE_S3_BUCKET="s3://dashql-app"
STABLE_CF_DIST="E1WT3LVZLA4YZX"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Building

# Compile the core in debug mode
.PHONY: core_debug
core_debug:
	mkdir -p ${CORE_DEBUG_DIR}
	cmake -S ${CORE_SOURCE_DIR} -B ${CORE_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	make -C ${CORE_DEBUG_DIR} -j ${CORES}

# Compile the core in release mode
.PHONY: core_release
core_release:
	mkdir -p ${CORE_RELEASE_DIR}
	cmake -S ${CORE_SOURCE_DIR} -B ${CORE_RELEASE_DIR} \
		-DCMAKE_BUILD_TYPE=Release
	make -C ${CORE_RELEASE_DIR} -j ${CORES}

# Build the dashql_core javascript library
.PHONY: core_js
core_js:
	npm --prefix ${ROOT_DIR}/core/js run build

# Test the dashql_core javascript library
.PHONY: core_js_test
core_js_test:
	npm --prefix ${ROOT_DIR}/core/js run test

# Build the wasm modules
.PHONY: wasm
wasm:
	./scripts/compile_wasm.sh

# Generate the protocol files
.PHONY: proto
proto:
	./scripts/generate_proto.sh

# Generate dashql grammar tests
.PHONY: grammar_testgen
grammar_testgen:
	${CORE_DEBUG_DIR}/grammar_testgen ${CORE_SOURCE_DIR}/test/grammar

# Test the dashql grammar
.PHONY: grammar_tests
grammar_tests:
	${CORE_DEBUG_DIR}/grammar_tests ${CORE_SOURCE_DIR}/test/grammar

# Creates a release archive
.PHONY: app_release
app_release:
	npm --prefix ${ROOT_DIR}/app run build:release
	tar -C "./app/build/release" -czf ${APP_RELEASE_ARCHIVE} .
	@echo "Release: ${APP_RELEASE_ARCHIVE}"

# Runs a node server with the release build
.PHONY: app_release_server
app_release_server:
	npm --prefix ${ROOT_DIR}/app run serve:release

# Starts the dev server
.PHONY: app_start
app_start:
	npm --prefix ${ROOT_DIR}/app run start

# Build the duckdb.wasm javascript library
.PHONY: duckdb_js
duckdb_js:
	npm --prefix ${ROOT_DIR}/duckdb/js run build

# Run the javascript tests duckdb.wasm
.PHONY: duckdb_js_test
duckdb_js_test:
	npm --prefix ${ROOT_DIR}/duckdb/js run test

# ---------------------------------------------------------------------------
# Environment

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands: 
	mkdir -p ${CORE_DEBUG_DIR}
	cmake -S ${CORE_SOURCE_DIR} -B ${CORE_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
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

# Build the docker dev image
.PHONY: docker_ci_image
docker_ci_image:
	tar -cvf - ./ci/image/Dockerfile | docker build \
		-t ${DOCKER_IMAGE_NAMESPACE}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG} \
		-f ./ci/image/Dockerfile \
		-

# Compile the flatc binary that is used to translate the flatbuffer definitions
.PHONY: flatc
flatc:
	mkdir -p ${FLATC_BASE_DIR}
	rm -r ${FLATC_BASE_DIR}
	mkdir -p ${FLATC_BUILD_DIR} ${FLATC_INSTALL_DIR}
	cmake -B${FLATC_BUILD_DIR} -S${FLATBUF_DIR} \
		-DCMAKE_CXX_STANDARD=17 \
		-DCMAKE_CXX_FLAGS=-std=c++17 \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_CXX_COMPILER=clang++ \
		-DCMAKE_C_COMPILER=clang \
		-DCMAKE_INSTALL_PREFIX=${FLATC_INSTALL_DIR} \
		-DFLATBUFFERS_BUILD_FLATLIB=ON \
		-DFLATBUFFERS_BUILD_FLATC=ON \
		-DFLATBUFFERS_BUILD_FLATHASH=OFF \
		-DFLATBUFFERS_INSTALL=ON \
		-DFLATBUFFERS_BUILD_TESTS=OFF \
		-DFLATBUFFERS_BUILD_SHAREDLIB=OFF
	make -C ${FLATC_BUILD_DIR} -j${CORES} install

# ---------------------------------------------------------------------------
# Deployment

# Upload the release build to the S3 bucket.
#
# We deliberately do not sync with --delete here.
# A client may still see the old index.html while we're propagating the new one.
# This would result in broken apps until the caches pick up the new version.
#
# We also rely on cache busting.
# All files in the static folder MUST include [contenthash] in the filename.
# That means that caches are never "stale" since an updated index.html will refer to new filenames.
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

# Upload the release build to the S3 bucket and cleanup old files.
#
# !! This will remove old webpack chunks that stale index.html files might still refer to. !!
#
# You have to wait at least `max-age` of the index.html before you can sync with --delete.
# Better run this command rarely and at least 1 day after running aws_stable_deploy with the same release.
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

# Invalidate cloudfront caches.
# You should never need this since we are using cache busting.
.PHONY: aws_stable_invalidate
aws_stable_invalidate:
	aws cloudfront create-invalidation \
		--distribution-id ${STABLE_CF_DIST} \
		--paths /
