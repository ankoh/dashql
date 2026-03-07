ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

UID=${shell id -u}
GID=${shell id -g}

LIB_SOURCE_DIR="${ROOT_DIR}/packages/dashql-core"
LIB_DEBUG_DIR="${LIB_SOURCE_DIR}/build/native/o0"
LIB_RELWITHDEBINFO_DIR="${LIB_SOURCE_DIR}/build/native/o2"
LIB_RELEASE_DIR="${LIB_SOURCE_DIR}/build/native/o3"
LIB_COVERAGE_DIR="${LIB_SOURCE_DIR}/build/coverage"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

LLVM_PROFDATA=llvm-profdata
LLVM_COV=llvm-cov
OS := $(shell uname)
ifeq ($(OS),Darwin)
	LLVM_PROFDATA=/opt/homebrew/opt/llvm/bin/llvm-profdata
	LLVM_COV=/opt/homebrew/opt/llvm/bin/llvm-cov
endif

# ---------------------------------------------------------------------------
# Parser

.PHONY: venv
venv:
	python3 -m venv ./.venv

.PHONY: infra_linux
infra_linux:
	./scripts/install_infra.sh linux
	rustup target add x86_64-unknown-linux-gnu

.PHONY: infra_macos
infra_macos:
	./scripts/install_infra.sh macos
	rustup target add aarch64-apple-darwin
	rustup target add x86_64-apple-darwin

.PHONY: flatbuf
flatbuf:
	./scripts/generate_flatbuf.sh

# Hermetic FlatBuffer TS via Bazel; optionally sync to packages/dashql-core-api/gen for local dev
.PHONY: flatbuf_bazel
flatbuf_bazel:
	bazel build //proto/fb:dashql_buffers_ts_gen
	rm -rf packages/dashql-core-api/gen/dashql
	mkdir -p packages/dashql-core-api/gen
	cp -R bazel-bin/proto/fb/dashql_buffers_ts/dashql packages/dashql-core-api/gen/

# Protobuf TS via Bazel. Symlink for editor: bazel run //packages/dashql-app:proto_symlink (or use make target below).
.PHONY: protobuf
protobuf: protobuf_bazel protobuf_symlink

.PHONY: protobuf_bazel
protobuf_bazel:
	bazel build //packages/dashql-app:proto

.PHONY: protobuf_symlink
protobuf_symlink:
	bazel run //packages/dashql-app:proto_symlink

.PHONY: core_native_o0
core_native_o0:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json
	cmake --build ${LIB_DEBUG_DIR} --parallel ${CORES}

.PHONY: core_native_o0_yydebug
core_native_o0_yydebug:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	    -DYYDEBUG=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json
	cmake --build ${LIB_DEBUG_DIR} --parallel ${CORES}

.PHONY: core_native_o0_cov
core_native_o0_cov:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCODE_COVERAGE=1 \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json
	cmake --build ${LIB_DEBUG_DIR} --parallel ${CORES}

.PHONY: core_native_o2
core_native_o2:
	mkdir -p ${LIB_RELWITHDEBINFO_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELWITHDEBINFO_DIR} -DCMAKE_BUILD_TYPE=RelWithDebInfo
	cmake --build ${LIB_RELWITHDEBINFO_DIR} --parallel ${CORES}

.PHONY: core_native_o3
core_native_o3:
	mkdir -p ${LIB_RELEASE_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELEASE_DIR} -DCMAKE_BUILD_TYPE=Release
	cmake --build ${LIB_RELEASE_DIR} --parallel ${CORES}

.PHONY: core_native_tests
core_native_tests:
	${LIB_DEBUG_DIR}/tester --source_dir . --gtest_filter="-*Rope*"

.PHONY: core_native_tests
core_native_tests_o2:
	${LIB_RELWITHDEBINFO_DIR}/tester --source_dir . --gtest_filter="-*Rope*"

.PHONY: core_native_tests_slow
core_native_tests_slow:
	${LIB_DEBUG_DIR}/tester --source_dir .

.PHONY: core_native_coverage
core_native_coverage:
	${LLVM_PROFDATA} merge -output=default.prof -instr default.profraw
	${LLVM_COV} show \
		--instr-profile default.prof \
		--format html \
		--ignore-filename-regex='.*/build/native/o0/.*' \
		--ignore-filename-regex='.*/build/native/o1/.*' \
		--ignore-filename-regex='.*/build/native/o2/.*' \
		--ignore-filename-regex='.*/utf8proc/.*' \
		--ignore-filename-regex='.*/proto/proto_generated.h' \
		--ignore-filename-regex='.*/.*\.list' \
		-o ${LIB_COVERAGE_DIR} \
		${LIB_DEBUG_DIR}/tester

.PHONY: benchmark_pipeline
benchmark_pipeline:
	${LIB_RELWITHDEBINFO_DIR}/benchmark_pipeline

.PHONY: benchmark_pipeline_ctes
benchmark_pipeline_ctes:
	${LIB_RELWITHDEBINFO_DIR}/benchmark_pipeline_ctes

.PHONY: benchmark_catalog
benchmark_catalog:
	${LIB_RELWITHDEBINFO_DIR}/benchmark_catalog

.PHONY: core_wasm_o0
core_wasm_o0:
	./scripts/build_core_wasm.sh o0

.PHONY: core_wasm_o2
core_wasm_o2:
	./scripts/build_core_wasm.sh o2

.PHONY: core_wasm_o3
core_wasm_o3:
	./scripts/build_core_wasm.sh o3

.PHONY: core_js_o0
core_js_o0:
	yarn workspace @ankoh/dashql-core build:o0

.PHONY: core_js_o2
core_js_o2:
	yarn workspace @ankoh/dashql-core build:o2

.PHONY: core_js_o3
core_js_o3:
	yarn workspace @ankoh/dashql-core build:o3

# Build dashql-core-api via Bazel (WASM + hermetic FlatBuffer TS) and copy to dist for link:../dashql-core-api
.PHONY: core_js_bazel
core_js_bazel:
	bazel build //packages/dashql-core-api:dist_wasm
	./scripts/copy_core_api_dist.sh

# Run dashql-core-api Jest tests via Bazel (transition builds wasm dist; uses workspace node_modules).
.PHONY: core_js_tests_bazel
core_js_tests_bazel:
	bazel test //packages/dashql-core-api:tests --test_env=BUILD_WORKSPACE_DIRECTORY=$$(pwd) --spawn_strategy=local --test_output=errors

.PHONY: core_js_tests
core_js_tests:
	yarn workspace @ankoh/dashql-core test

.PHONY: core_js_filter
core_js_tests_filter:
	yarn workspace @ankoh/dashql-core test:filter

.PHONY: core_js_debug
core_js_tests_debug:
	yarn workspace @ankoh/dashql-core test:debug

.PHONY: compute_wasm_o0
compute_wasm_o0:
	RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\" -C link-arg=-zstack-size=8388608" yarn run compute:wasm:o0

.PHONY: compute_wasm_o3
compute_wasm_o3:
	RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\" -C link-arg=-zstack-size=8388608" yarn run compute:wasm:o3

# PWA build and dev via Vite + rules_js. Run "pnpm install" after adding deps (see docs/agents/vite_bazel.md).
.PHONY: pwa_pages
pwa_pages:
	bazel build //packages/dashql-app:pages

.PHONY: pwa_reloc
pwa_reloc:
	bazel build //packages/dashql-app:reloc

.PHONY: pwa_dev
pwa_dev:
	bazel run //packages/dashql-app:vite_dev

.PHONY: pwa_dev_trace
pwa_dev_trace:
	DASHQL_LOG_LEVEL=trace bazel run //packages/dashql-app:vite_dev

.PHONY: vite_dev_bazel
vite_dev_bazel:
	bazel run //packages/dashql-app:vite_dev

.PHONY: vite_reloc_bazel
vite_reloc_bazel:
	bazel build //packages/dashql-app:reloc

.PHONY: vite_pages_bazel
vite_pages_bazel:
	bazel build //packages/dashql-app:pages

.PHONY: pwa_tests_bazel
pwa_tests_bazel:
	bazel test //packages/dashql-app:pwa_tests

.PHONY: pwa_tests
pwa_tests:
	yarn workspace @ankoh/dashql-app test

.PHONY: pwa_tests_verbose
pwa_tests_verbose:
	yarn workspace @ankoh/dashql-app test --verbose=true

.PHONY: js_tests
js_tests: core_js_tests pwa_tests

.PHONY: lint
lint:
	DEBUG=eslint:cli-engine yarn run eslint

.PHONY: native_mac_dev
native_mac_dev:
	yarn run tauri dev

.PHONY: native_mac_o0
native_mac_o0:
	yarn run tauri build --ci --bundles dmg --debug --verbose

.PHONY: native_mac
native_mac_universal:
	yarn run tauri build --ci --target universal-apple-darwin --bundles dmg

.PHONY: native_mac_updates
native_mac_updates:
	yarn run tauri build --ci --bundles updater,app

.PHONY: native_tests
native_tests:
	cargo test --manifest-path cargo/native/Cargo.toml

.PHONY: svg_symbols
svg_symbols:
	python3 ./scripts/generate_svg_symbols.py

.PHONY: snapshots
snapshots:
	${LIB_DEBUG_DIR}/snapshotter --source_dir .

.PHONY: snapshots_o2
snapshots_o2:
	${LIB_RELWITHDEBINFO_DIR}/snapshotter --source_dir .

.PHONY: snapshots_lldb
snapshots_lldb:
	lldb -- ${LIB_DEBUG_DIR}/snapshotter --source_dir .

.PHONY: clean
clean:
	rm -rf ${ROOT_DIR}/target
	rm -rf ${ROOT_DIR}/cargo/native/target
	rm -rf ${ROOT_DIR}/packages/dashql-app/build
	rm -rf ${ROOT_DIR}/packages/dashql-compute/dist
	rm -rf ${ROOT_DIR}/packages/dashql-core/build
	rm -rf ${ROOT_DIR}/packages/dashql-native/gen

.PHONY: all
all: flatbuf protobuf core_native_o0 core_wasm_o2 core_js_o2 compute_wasm_o3
