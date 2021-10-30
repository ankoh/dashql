# Copyright (c) 2020 The DashQL Authors

.DEFAULT_GOAL := core

# ---------------------------------------------------------------------------
# Config

ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

UID=${shell id -u}
GID=${shell id -g}

APP_RELEASE_DIR="${ROOT_DIR}/packages/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"

LIB_SOURCE_DIR="${ROOT_DIR}/lib"
LIB_DEBUG_DIR="${ROOT_DIR}/lib/build/Debug"
LIB_RELEASE_DIR="${ROOT_DIR}/lib/build/Release"
LIB_RELWITHDEBINFO_DIR="${ROOT_DIR}/lib/build/RelWithDebInfo"
CORE_WASM_DIR="${ROOT_DIR}/packages/core/src/wasm"
DATAFRAME_WASM_DIR="${ROOT_DIR}/packages/dataframe/src/wasm"

CI_IMAGE_NAMESPACE="dashql"
CI_IMAGE_NAME="ci"
CI_IMAGE_TAG="$(shell cat ./actions/image/TAG)"
CI_IMAGE_FULLY_QUALIFIED="${CI_IMAGE_NAMESPACE}/${CI_IMAGE_NAME}:${CI_IMAGE_TAG}"
CACHE_DIRS=${ROOT_DIR}/.ccache/ ${ROOT_DIR}/.emscripten_cache/
IN_IMAGE_MOUNTS=-v${ROOT_DIR}:${ROOT_DIR}:delegated -v${ROOT_DIR}/.emscripten_cache/:/mnt/emscripten_cache/:delegated -v${ROOT_DIR}/.ccache/:/mnt/ccache/:delegated
IN_IMAGE_ENV=-e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=${ROOT_DIR}/lib/ -e EM_CACHE=/mnt/emscripten_cache/
EXEC_ENVIRONMENT?=docker run -it --rm ${IN_IMAGE_MOUNTS} ${IN_IMAGE_ENV} "${CI_IMAGE_FULLY_QUALIFIED}"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Formatting

# Format all source files
.PHONY: format
format:
	${ROOT_DIR}/scripts/format

.PHONY: check_format
check_format:
	${ROOT_DIR}/scripts/format check

# ---------------------------------------------------------------------------
# Building

# Compile the core in debug mode
.PHONY: lib
lib:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ninja -C ${LIB_DEBUG_DIR}

# Compile the core in release mode
.PHONY: lib_relwithdebinfo
lib_relwithdebinfo:
	mkdir -p ${LIB_RELWITHDEBINFO_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELWITHDEBINFO_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=RelWithDebInfo
	ninja -C ${LIB_RELWITHDEBINFO_DIR}

# Compile the core in release mode
.PHONY: lib_release
lib_release:
	mkdir -p ${LIB_RELEASE_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELEASE_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Release
	ninja -C ${LIB_RELEASE_DIR}

# Perf the library
.PHONY: lib_perf
lib_perf: lib_relwithdebinfo
	perf record --call-graph dwarf ${LIB_RELWITHDEBINFO_DIR}/tester --source_dir ${LIB_SOURCE_DIR} --gtest_filter=*CSV*ParseTest
	hotspot ./perf.data

# Test the core library
.PHONY: lib_tests
lib_tests: lib
	${LIB_DEBUG_DIR}/tester --source_dir ${LIB_SOURCE_DIR} --gtest_filter=*

# Debug the core library
.PHONY: lib_tests
lib_tests_lldb: lib
	lldb ${LIB_DEBUG_DIR}/tester -- --source_dir ${LIB_SOURCE_DIR} --gtest_filter=*

# Debug the core library
.PHONY: lib_tests
lib_tests_gdb: lib
	gdb --args ${LIB_DEBUG_DIR}/tester --source_dir ${LIB_SOURCE_DIR} --gtest_filter=*

# Test the core library
.PHONY: lib_tests_relwithdebinfo
lib_tests_relwithdebinfo: lib_relwithdebinfo
	${LIB_RELWITHDEBINFO_DIR}/tester --source_dir ${LIB_SOURCE_DIR}

# Test the core library
.PHONY: lib_tests_relwithdebinfo_lldb
lib_tests_relwithdebinfo_lldb: lib_relwithdebinfo
	lldb ${LIB_RELWITHDEBINFO_DIR}/tester -- --source_dir ${LIB_SOURCE_DIR}

# Generate declarative tests
.PHONY: lib_testgen
lib_testgen: lib
	${LIB_DEBUG_DIR}/testgen ${LIB_SOURCE_DIR}

# Generate declarative tests
.PHONY: lib_testgen_gdb
lib_testgen_lldb: lib
	lldb ${LIB_DEBUG_DIR}/testgen -- ${LIB_SOURCE_DIR}

# Debug the library
.PHONY: lib_debug
lib_debug: lib
	lldb --args ${LIB_DEBUG_DIR}/tester ${LIB_SOURCE_DIR}



.PHONY: js_tests
js_tests:
	NODE_NO_WARNINGS=1 node --experimental-vm-modules --liftoff --no-wasm-tier-up ./node_modules/.bin/jest

# Test the dashql_core javascript library
.PHONY: js_tests_cov
js_tests_cov:
	NODE_NO_WARNINGS=1 node --experimental-vm-modules --liftoff --no-wasm-tier-up ./node_modules/.bin/jest --collect-coverage


.PHONY: js_tests_debug
js_tests_debug:
	NODE_NO_WARNINGS=1 node --experimental-vm-modules --liftoff --no-wasm-tier-up --inspect-brk=0.0.0.0:9229 ./node_modules/.bin/jest packages/core/__tests__/tasks/scenario_genseries.test.ts

.PHONY: js_update_snaps
js_update_snaps:
	NODE_NO_WARNINGS=1 node --experimental-vm-modules --liftoff --no-wasm-tier-up ./node_modules/.bin/jest --updateSnapshot

# Compile the flatbuffer schema
.PHONY: proto
proto:
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/generate_proto.sh
	yarn workspace @dashql/proto build

# Make sure we can access the wasm caches
wasm_caches:
	mkdir -p ${ROOT_DIR}/.ccache ${ROOT_DIR}/.emscripten_cache
	chown -R $(id -u):$(id -g) ${ROOT_DIR}/.ccache ${ROOT_DIR}/.emscripten_cache

# Build the wasm module with debug info
.PHONY: wasm
wasm: wasm_caches
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build.sh Fast

# Build the wasm modules with all debug info
.PHONY: wasm_debug
wasm_debug: wasm_caches
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build.sh Debug

# Build the wasm modules
.PHONY: wasm_release
wasm_release: wasm_caches
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build.sh Release

# Builds the app
.PHONY: app
app:
	yarn workspace @dashql/core build:app:dev

# Creates a release archive
.PHONY: app_release
app_prod:
	yarn workspace @dashql/core build:app:prod

# Starts the dev server
.PHONY: app_start
app_start:
	yarn workspace @dashql/core start

# C++ formatting
.PHONY: clang_format
clang_format:
	python3 ./scripts/run_clang_format.py \
	--exclude ./lib/build \
	--exclude ./lib/third_party \
	-r ./lib/

# JS formatting
.PHONY: eslint
eslint:
	yarn workspace @dashql/core run lint
	yarn workspace @dashql/benchmarks run lint
	yarn workspace @dashql/core run lint

# Install all yarn packages
.PHONY: yarn_install
yarn_install:
	yarn

# ---------------------------------------------------------------------------
# Environment

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands: 
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json

# Clean the repository
.PHONY: clean
clean:
	git clean -xfd
	git submodule foreach --recursive git clean -xfd
	git submodule update --init --recursive

# Build the docker dev image
.PHONY: docker_ci_image
docker_ci_image:
	tar -cvf - ./actions/image/Dockerfile | docker build \
		--platform linux/amd64 \
		-t ${CI_IMAGE_FULLY_QUALIFIED} \
		-f ./actions/image/Dockerfile \
		--build-arg UID=${UID} \
		--build-arg GID=${GID} \
		-

# Build infrastructure and packages required for development
.PHONY: bootstrap
bootstrap:
	git submodule update --init --recursive
	make docker_ci_image yarn_install
	make proto
	make wasm
	make core
