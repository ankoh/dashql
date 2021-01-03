# Copyright (c) 2020 The DashQL Authors

.DEFAULT_GOAL := core

# ---------------------------------------------------------------------------
# Config

ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

APP_RELEASE_DIR="${ROOT_DIR}/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"

LIB_SOURCE_DIR="${ROOT_DIR}/lib"
LIB_DEBUG_DIR="${ROOT_DIR}/lib/build/debug"
LIB_RELEASE_DIR="${ROOT_DIR}/lib/build/release"
CORE_WASM_DIR="${ROOT_DIR}/core/src/wasm"
WEBDB_WASM_DIR="${ROOT_DIR}/webdb/src/wasm"

CI_IMAGE_NAMESPACE="dashql"
CI_IMAGE_NAME="ci"
CI_IMAGE_TAG="$(shell cat ./ci/image/TAG)"
CI_IMAGE_FULLY_QUALIFIED="${CI_IMAGE_NAMESPACE}/${CI_IMAGE_NAME}:${CI_IMAGE_TAG}"
IN_IMAGE_MOUNTS=-v${ROOT_DIR}:/wd/ -v${ROOT_DIR}/.emscripten_cache/:/mnt/emscripten_cache/ -v${ROOT_DIR}/.ccache/:/mnt/ccache/
IN_IMAGE_ENV=-e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=/wd/core/cpp/
EXEC_ENVIRONMENT?=docker run --rm ${IN_IMAGE_MOUNTS} ${IN_IMAGE_ENV} "${CI_IMAGE_FULLY_QUALIFIED}"

CDN_S3_BUCKET="s3://dashql-cdn"
CDN_CF_DIST="E18RW837PIKROW"
APP_STABLE_S3_BUCKET="s3://dashql-app"
APP_STABLE_CF_DIST="E1WT3LVZLA4YZX"
APP_NIGHTLY_S3_BUCKET="s3://dashql-app-nightly"
APP_NIGHTLY_CF_DIST="EQPYKLIF8GRS4"
WEBSITE_S3_BUCKET="s3://dashql-cdn"
WEBSITE_CF_DIST="E2N5KIE8UNXGM3"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Building

# Compile the core in debug mode
.PHONY: lib
lib:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	make -C ${LIB_DEBUG_DIR} -j ${CORES}

# Compile the core in release mode
.PHONY: lib_release
lib_release:
	mkdir -p ${LIB_RELEASE_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELEASE_DIR} \
		-DCMAKE_BUILD_TYPE=Release
	make -C ${LIB_RELEASE_DIR} -j ${CORES}

# Test the core library
.PHONY: lib_tests
lib_tests: lib
	${LIB_DEBUG_DIR}/tester ${LIB_SOURCE_DIR}

# Generate declarative tests
.PHONY: testgen
lib_testgen: lib
	${LIB_DEBUG_DIR}/testgen ${LIB_SOURCE_DIR}

# Debug the library
.PHONY: lib_debug
lib_debug: lib
	lldb --args ${LIB_DEBUG_DIR}/tester ${LIB_SOURCE_DIR}

# Build the dashql_core javascript library
.PHONY: core
core:
	npm --prefix ${ROOT_DIR}/core run build

# Build the dashql_core javascript library
.PHONY: core_watch
core_watch:
	npm --prefix ${ROOT_DIR}/core run build:watch

# Test the dashql_core javascript library
.PHONY: core_tests
core_tests:
	npm --prefix ${ROOT_DIR}/core run test

# Build the benchmarks
.PHONY: benchmarks
benchmarks:
	npm --prefix ${ROOT_DIR}/benchmarks run build

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

# Runs a node server with the release build
.PHONY: app_release_server
app_release_server:
	npm --prefix ${ROOT_DIR}/app run serve:release

# Starts the dev server
.PHONY: app_start
app_start:
	npm --prefix ${ROOT_DIR}/app run start

# Build the webdb library
.PHONY: webdb
webdb:
	npm --prefix ${ROOT_DIR}/webdb run build

# Run the javascript tests
.PHONY: webdb_tests
webdb_tests:
	npm --prefix ${ROOT_DIR}/webdb run test

# Install all npm packages
.PHONY: npm_install
npm_install:
	npm --prefix ${ROOT_DIR}/webdb install
	npm --prefix ${ROOT_DIR}/core install
	npm --prefix ${ROOT_DIR}/app install
	npm --prefix ${ROOT_DIR}/proto install

# ---------------------------------------------------------------------------
# Environment

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands: 
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${ROOT_DIR}/compile_commands.json

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
		--platform linux/amd64 \
		-t ${CI_IMAGE_FULLY_QUALIFIED} \
		-f ./ci/image/Dockerfile \
		-

# ---------------------------------------------------------------------------
# Deployment

.PHONY: aws_stable_deploy
aws_stable_deploy:
	./scripts/s3_cp_app.sh ${APP_STABLE_S3_BUCKET} ./app/build/release

# Remove old app versions.
# Make sure a newer versions exist and that the CDN no longer refers to an outdated index.html!
.PHONY: aws_stable_prune
aws_stable_prune:
	./scripts/s3_rm_outdated.sh ${APP_STABLE_S3_BUCKET} "1 week"

# Deploy a nightly build
.PHONY: aws_nightly_deploy
aws_nightly_deploy:
	./scripts/s3_cp_app.sh ${APP_NIGHTLY_S3_BUCKET} ./app/build/release

# Remove old app versions.
# Make sure a newer versions exist and that the CDN no longer refers to an outdated index.html!
.PHONY: aws_nightly_prune
aws_nightly_prune:
	./scripts/s3_rm_outdated.sh ${APP_NIGHTLY_S3_BUCKET} "1 month"

# ---------------------------------------------------------------------------
# Data

# Package the uni schema data
UNI_SCHEMA_DIR="${ROOT_DIR}/demos/uni"
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
