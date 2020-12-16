# Copyright (c) 2020 The DashQL Authors

.DEFAULT_GOAL := core

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
CORE_JS_WASM_DIR="${ROOT_DIR}/core/js/src/wasm"
DUCKDB_JS_WASM_DIR="${ROOT_DIR}/duckdb/js/src/wasm"

CI_IMAGE_NAMESPACE="dashql"
CI_IMAGE_NAME="ci"
CI_IMAGE_TAG="$(shell cat ./ci/image/TAG)"
CI_IMAGE_FULLY_QUALIFIED="${CI_IMAGE_NAMESPACE}/${CI_IMAGE_NAME}:${CI_IMAGE_TAG}"
IN_IMAGE_MOUNTS=-v${ROOT_DIR}:/wd/ -v${ROOT_DIR}/.emscripten_cache/:/mnt/emscripten_cache/ -v${ROOT_DIR}/.ccache/:/mnt/ccache/
IN_IMAGE_ENV=-e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=/wd/core/cpp/
EXEC_ENVIRONMENT?=docker run --rm ${IN_IMAGE_MOUNTS} ${IN_IMAGE_ENV} "${CI_IMAGE_FULLY_QUALIFIED}"

CDN_S3_BUCKET="s3://dashql-cdn"
STABLE_S3_BUCKET="s3://dashql-app"
STABLE_CF_DIST="E1WT3LVZLA4YZX"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Building

# Compile the core in debug mode
.PHONY: core
core:
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

# Test the core library
.PHONY: core_tests
core_tests:
	${CORE_DEBUG_DIR}/tester ${CORE_SOURCE_DIR}

# Generate declarative tests
.PHONY: testgen
core_testgen:
	${CORE_DEBUG_DIR}/testgen ${CORE_SOURCE_DIR}

# Test the duckdb library
.PHONY: duckdb_tests
duckdb_tests:
	${CORE_DEBUG_DIR}/duckdb/duckdb_tester


# Build the dashql_core javascript library
.PHONY: core_js
core_js:
	npm --prefix ${ROOT_DIR}/core/js run build

# Build the dashql_core javascript library
.PHONY: core_js_watch
core_js_watch:
	npm --prefix ${ROOT_DIR}/core/js run build:watch

# Test the dashql_core javascript library
.PHONY: core_js_tests
core_js_tests:
	npm --prefix ${ROOT_DIR}/core/js run test:silent

# Compile the flatbuffer schema
.PHONY: proto
proto:
	${EXEC_ENVIRONMENT} bash -ec ./scripts/generate_proto.sh
	npm --prefix ${ROOT_DIR}/proto run build

# Build the wasm module with debug info
.PHONY: wasm
wasm:
	${EXEC_ENVIRONMENT} bash -ec "./scripts/compile_wasm.sh RelWithDebInfo"

# Build the wasm modules
.PHONY: wasm_release
wasm_release:
	${EXEC_ENVIRONMENT} bash -ec "./scripts/compile_wasm.sh Release"

# Builds the app
.PHONY: app
app:
	npm --prefix ${ROOT_DIR}/app run build:debug

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
duckdb_js_tests:
	npm --prefix ${ROOT_DIR}/duckdb/js run test

# Install all npm packages
.PHONY: npm_install
npm_install:
	npm --prefix ${ROOT_DIR}/duckdb/js install
	npm --prefix ${ROOT_DIR}/core/js install
	npm --prefix ${ROOT_DIR}/app install
	npm --prefix ${ROOT_DIR}/proto install

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
		-t ${CI_IMAGE_FULLY_QUALIFIED} \
		-f ./ci/image/Dockerfile \
		-

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

# ---------------------------------------------------------------------------
# Examples

# Package the uni schema data
UNI_SCHEMA_DIR="${ROOT_DIR}/examples/uni"
UNI_SCHEMA_OUT="${UNI_SCHEMA_DIR}/out"
UNI_SCHEMA_PKG="${UNI_SCHEMA_DIR}/target/release/pkg_uni"
.PHONY: pkg_uni_schema
pkg_uni:
	cargo +nightly build --manifest-path="${UNI_SCHEMA_DIR}/Cargo.toml" --release
	mkdir -p ${UNI_SCHEMA_OUT}
	${UNI_SCHEMA_PKG} ${UNI_SCHEMA_OUT}
	cd ${UNI_SCHEMA_OUT} && rm -f ./tables.zip && zip ./tables.zip ./*.parquet

# Copy university schema data to s3
aws_update_uni:
	aws s3 cp "${UNI_SCHEMA_OUT}/tables.zip" "${CDN_S3_BUCKET}/demo/uni/tables-de.zip" \
		--cache-control "max-age=604800" \
		--acl public-read
