# dashql-core: CMake → Bazel migration exploration

This document outlines what it would take to migrate the C++ project `dashql-core` from CMake to Bazel. The migration is split into three main areas: grammar/parser build, external dependencies, and WebAssembly/Binaryen.

## Current status (Bazel build)

- **Working**: Version genrule, grammar assembly (Python script + genrule), **prebuilt Bison + M4 + Flex** (xPack, downloaded by Bazel; no host install), vendor libs (utf8proc, frozen), **all external projects resolved under top-level `bazel/`** (extension `external_projects.bzl` + build overlays `external_*.BUILD`: flatbuffers, ankerl, rapidjson, c4core, rapidyaml, **com_google_benchmark**, **duckdb** via rules_foreign_cc; googletest/gflags from BCR), main `dashql` cc_library, **dashql_testutils** library, **tester** binary (all tests except `catalog_test`, which awaits wiring to `@duckdb//:duckdb`).
- **Requires local tools**: None for parser/scanner (Bison, M4, Flex are all prebuilt xPack).
- **Not yet ported**: Wiring `catalog_test` to `@duckdb//:duckdb`, benchmark binaries, WASM toolchain, Binaryen post-processing.

### Making the tester work

1. **Bison, M4, Flex**: Bazel downloads prebuilt xPack binaries for your platform; no install needed.
2. **Grammar keyword lists**: `keywords.cc` and `tokens.cc` use `#include "grammar_lists/sql_*.list"`; a genrule copies from `//grammar` and `grammar_lists_include` exposes the include path. For CMake, add a symlink `grammar_lists -> ../../grammar/lists` and `include_directories(${CMAKE_SOURCE_DIR})` so the same includes work.
3. **macOS**: `-mmacosx-version-min=13.3` is used (for `std::format` / `std::to_chars`); set in `DASHQL_COPTS` and `DASHQL_LINKOPTS` via `:macos` config_setting.
4. **Build and run tests**: Snapshot tests depend on their own snapshot filegroup (e.g. `parser_tests` has `data = ["//snapshots:parser_snapshots"]`). Snapshots are discovered lazily: when a snapshot test suite’s `GetTests()` runs (during test instantiation), it calls `GetRunfilesSnapshotRoot()` and loads from that root (uses `RUNFILES_DIR` on Unix and `RUNFILES_MANIFEST_FILE` on Windows). No setup in `main()`; each test binary finds its own snapshots. Example:
   ```bash
   bazel test //packages/dashql-core:parser_tests
   bazel test //packages/dashql-core:all
   ```
   When not under Bazel, run the test binary from the repo root so that `GetRunfilesSnapshotRoot()` falls back to `.` and snapshots are found under `./snapshots/`.

---

## Current CMake layout (summary)

- **Root** `CMakeLists.txt`: project config, sanitizers, coverage, WASM flags, includes, parser assembly, `dashql` lib/executable, tests, benchmarks, tools.
- **Grammar**: assembled from `../../grammar/` (prologue, keyword lists, precedences, rule types, rules, epilogue) into a single `dashql.y`, then Bison → parser, Flex → scanner.
- **ExternalProject_Add** (in `cmake/`): flatbuffers, ankerl (unordered_dense), rapidjson, gtest, gflags, benchmark, rapidyaml, duckdb. In Bazel, all of these are resolved under the top-level `bazel/` folder (extension `external_projects.bzl` + `external_*.BUILD` overlays); duckdb is built via rules_foreign_cc cmake.
- **Vendor (in-tree)**: `vendor/utf8proc`, `vendor/frozen` (both `add_subdirectory`).
- **Version**: `cmake/version.cmake` + `version.cc.tpl` → generated `version.cc` (git describe, etc.).
- **WASM**: Clang `--target=wasm32-wasi`, custom exports, LTO. Binaryen is used **only** in a **post-build script** (`scripts/build_core_wasm.sh`): `wasm-opt -O3` and `wasm-strip` for optimized builds; no CMake integration.

---

## A) Bison/Flex and grammar assembly

### Current behavior

1. **Grammar assembly** (single `dashql.y`):
   - **Prologue**: `grammar/prologue.y`
   - **Declarations**: awk over `grammar/lists/*.list` (CSV-like `X(CATEGORY, "keyword", TOKEN)`) to emit `%type<std::string_view> <basename>` and `%token<std::string_view> TOKEN1 TOKEN2 ...`
   - **Precedences**: `grammar/precedences.y`
   - **Types**: `grammar/rules/*.yh`
   - **`%%`** (rules section)
   - **Keyword rules**: second awk over the same lists → `<basename>: TOKEN1{$$=$1;} | TOKEN2{$$=$1;}; ...`
   - **Rule files**: `grammar/rules/*.y` (sql_create, sql_select, sql_view, ext_*)
   - **`%%`** (code section)
   - **Epilogue**: `grammar/epilogue.y`

2. **Parser/Scanner**:
   - Flex: `grammar/scanner.l` → `scanner_generated.cc` (with `-F -8`).
   - Bison: assembled `dashql.y` → `parser_generated.cc` + `parser_generated.h`; then `sed -e 's/private:/protected:/g'` on the header.

3. **Paths**: Grammar lives in repo root `grammar/`; generated sources go to `include/dashql/parser/` (scanner/parser). Bison report goes to `bison.log`.

### Bazel approach

- **Grammar assembly**: Implement as a **genrule** (or a Starlark rule if you want better dependency handling and hermeticity).
  - **Inputs**: All of `grammar/` (prologue, epilogue, precedences, lists, rules, .yh).
  - **Output**: Single `dashql.y` in `bazel-bin` (or a genfiles dir).
  - **Command**: Same sequence of `cat` and `awk` as in CMake. Run from a directory that has access to the grammar tree (e.g. run from workspace root or pass paths via `$(location ...)` and a small script).
  - **Hermeticity**: Prefer a single shell script that takes `SRCDIR` and `OUT` and is checked in (e.g. `//grammar:assemble_grammar.py`), and have the genrule call it with `$(location ...)` paths. Avoid relying on system `awk` behavior differences; if needed, use a Python script for the two “awk” steps for portability.

- **Bison**:
  - Use **rules_flex** and **rules_bison** (or the bison/flex support in **rules_cc** if available). Alternatively, a **genrule** that runs `bison --defines=... --output=...` and then runs `sed` on the generated header.
  - **Important**: Bison must produce the same output names and locations the rest of the code expects: `parser_generated.cc`, `parser_generated.h`, and the header must be post-processed (private → protected). So either:
    - Configure the bison rule to output those names and add a follow-up step for the header, or
    - Keep a genrule that runs bison + sed and declares the two outputs.

- **Flex**:
  - One genrule or rule that runs flex with `--outfile=scanner_generated.cc -F -8` on `grammar/scanner.l`. Output must be `scanner_generated.cc` under a path that matches `#include` expectations (e.g. `include/dashql/parser/` or an equivalent in genfiles and `-I`).

- **Include layout**: The C++ code expects headers under `include/dashql/...` and generated parser under `include/dashql/parser/`. In Bazel, either:
  - Emit generated sources into a package that is used as `include_prefix` / strip prefix, or
  - Add a `cc_library` that has the generated files and the right `includes`/`include_prefix` so that `#include "dashql/parser/parser_generated.h"` etc. resolve.

- **Parser compile options (WASM)**: CMake compiles `parser_generated.cc` with `-O1` in Debug WASM to avoid excessive locals. In Bazel you’ll need the same: a target-specific copts for that file in the WASM config (e.g. `-O1` for the parser object when building for wasm).

**Concrete steps**

1. The script `grammar/assemble_grammar.py` takes grammar paths via arguments and writes `dashql.y`. The genrule `//grammar:grammar_y` depends on all grammar inputs and produces `dashql.y`.
2. (Grammar assembly genrule lives in `//grammar:grammar_y`.)
3. Add a genrule (or bison rule) that takes `dashql.y` and produces `parser_generated.cc` and `parser_generated.h`, then runs `sed` on the header.
4. Add a genrule or flex rule for `scanner_generated.cc`.
5. Create a `cc_library` for the parser that includes these generated sources and the correct include path, and (for WASM) apply `-O1` to `parser_generated.cc` in the WASM toolchain/config.

---

## B) External dependencies (ExternalProject_Add)

Current deps and how they’re used:

| Dep           | Use                    | WASM? | Notes |
|---------------|------------------------|-------|--------|
| flatbuffers   | lib + include          | Yes   | Git tag ee848a0, FLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION |
| ankerl        | header-only (include)  | Yes   | unordered_dense, tag 3add2a6 |
| rapidjson     | header-only (include)  | Yes   | tag 24b5e7a8b27f42fa16b96fc70aade9106cf7102f |
| utf8proc      | in-tree vendor lib     | Yes   | static lib |
| frozen        | in-tree vendor         | Yes   | header-only |
| gtest/gmock   | tests only             | No    | 6910c9d |
| gflags        | tests/tools            | No    | e171aa2 |
| benchmark     | benchmarks             | No    | d572f47 |
| rapidyaml     | tests (YAML snapshots) | No    | v0.10.0, needs ext/c4core |
| duckdb        | tests only             | No    | 6ddac80, many byproducts |

### Bazel options

1. **Use existing Bazel-friendly upstreams**
   - **flatbuffers**: Has a Bazel build; use `http_archive` + their `WORKSPACE`/build or a mirror.
   - **gtest**: Official repo supports Bazel; use `http_archive` for googletest.
   - **gflags, benchmark**: Often consumed via `http_archive` and their native BUILD files, or via a registry (see below).
   - **rapidjson**: Header-only; can be a simple `http_archive` + `cc_library` with `hdrs` and `includes`.
   - **ankerl (unordered_dense)**: Header-only; same idea.
   - **rapidyaml**: May need `rules_foreign_cc` or a custom BUILD if there’s no official Bazel support; it builds ryml + c4core static libs.
   - **duckdb**: Large; has or is getting Bazel support; otherwise `rules_foreign_cc` or a prebuilt.

2. **rules_foreign_cc**
   - For projects that only have CMake (e.g. rapidyaml, duckdb, or a specific flatbuffers version), use **rules_foreign_cc** to build them via CMake inside Bazel.
   - You get a `cc_import` or `cc_library`-like target and can depend on it from `dashql-core`. This replaces `ExternalProject_Add` conceptually.

3. **Bzlmod / central registry**
   - If you adopt Bzlmod, you can depend on modules that wrap these projects (e.g. flatbuffers, gtest) and reduce boilerplate in the root WORKSPACE.

4. **Vendor (utf8proc, frozen)**
   - **utf8proc**: Small; add a `BUILD` under `vendor/utf8proc` with a `cc_library` for the existing sources.
   - **frozen**: Header-only; add a `cc_library` with `hdrs` and `includes`.

5. **Version script**
   - Replace `version.cmake` + template with a **genrule** or **ctx.actions.run** that runs `git describe` (or a stamp script) and writes `version.cc`. Bazel’s stamping can drive this so builds are reproducible.

**Concrete steps**

1. Create a root `WORKSPACE` (or use existing repo root) and add `http_archive` for flatbuffers, googletest, gflags, benchmark; add small wrapper BUILD for rapidjson and ankerl (header-only).
2. Add BUILD files for `vendor/utf8proc` and `vendor/frozen`.
3. Add a version genrule that generates `version.cc` from a template and git/stamp info.
4. For rapidyaml: add `rules_foreign_cc` and a `cmake` target, or a custom BUILD that builds ryml + c4core.
5. For duckdb: add `rules_foreign_cc` or use an existing Bazel overlay; link the static libs and include dirs as in CMake.

---

## C) Binaryen and WebAssembly

### Current role of Binaryen

- **Not** used inside CMake. Used only in **`scripts/build_core_wasm.sh`** after the WASM binary is built:
  - For optimized builds (e.g. “o3”): run `wasm-opt -O3` on the emitted `.wasm`, then `wasm-strip`.
  - For debug: optionally generate a source map via `wasm_sourcemap.py` (no Binaryen).

So Binaryen is a **host tool** for post-processing the core WebAssembly artifact.

### Bazel options

1. **Prebuilt Binaryen (recommended)**
   - Add a **repository_rule** (or use a helper like `rules_foreign_cc`’s toolchain pattern) that:
     - Downloads the official Binaryen release tarball (e.g. from GitHub) for the host platform (linux/mac).
     - Unpacks it and exposes `wasm-opt` and optionally `wasm-strip` (or use wabt’s `wasm-strip` if you already have it) as runnable binaries.
   - In the Bazel graph, the “core_wasm” (or similar) target produces `dashql_core.wasm`. Add a **genrule** (or a Starlark rule) that:
     - Takes that `.wasm` as input.
     - Runs `$(location @binaryen//:wasm-opt)` (and optionally strip) for the optimized build.
     - Outputs the final `.wasm` (and optionally a source map for debug).
   - No need to **build** Binaryen from source; you only need the prebuilt binaries. So **rules_foreign_cc for Binaryen itself is optional** (only if you insist on building Binaryen from source).

2. **Build Binaryen with rules_foreign_cc**
   - If you want to build Binaryen from source (e.g. to pin an unreleased fix), use **rules_foreign_cc** to build the Binaryen CMake project and expose `wasm-opt` as a binary. Then use that in the same genrule/rule as above. This is more work and slower; only do it if necessary.

3. **WASI / WASM toolchain**
   - Bazel has **rules for building C/C++ to WASM** (e.g. Emscripten or a custom toolchain). You need:
     - A **WASI toolchain** (or clang targeting `wasm32-wasi`) registered in Bazel.
     - The same compiler/linker flags as in CMake: `-DWASM=1`, `--target=wasm32-wasi`, `-fno-exceptions`, LTO, and the long list of `-Wl,--export=...` symbols.
   - This is independent of Binaryen: first produce `dashql_core.wasm` with the toolchain; then in a separate action run Binaryen on that file.

4. **Source maps**
   - Your current script uses `llvm-dwarfdump` and `wasm_sourcemap.py` for debug. In Bazel, add a genrule or Starlark action that runs those tools when building the debug WASM target, and outputs `dashql_core.wasm.map` (or equivalent).

**Concrete steps**

1. Add a repo that fetches Binaryen release tarball and exposes `wasm-opt` (and optionally `wasm-strip` or rely on wabt).
2. Define a WASM toolchain (or reuse an existing one) that uses clang + wasi-sdk and matches current CMake flags and exports.
3. Build `dashql` as a WASM binary (executable or shared library, depending on how you consume it).
4. Add a genrule/rule that takes this binary and runs `wasm-opt -O3` + strip for release, and optionally `wasm_sourcemap.py` for debug.
5. Document that CI or local “install” of Binaryen (e.g. your existing `.github/actions/setup-binaryen` or `scripts/install_infra.sh`) is replaced by the Bazel fetch of Binaryen for the host.

---

## Suggested order of work

1. **Vendor + version**  
   Add BUILD files for utf8proc and frozen, and a version genrule. No ExternalProject yet.

2. **Grammar + parser**  
   Implement grammar assembly and Bison/Flex in Bazel; build the `dashql` library for the **native** host (no WASM yet). Fix include paths and the parser’s `-O1` for the single file if you already have a WASM config.

3. **External deps (native)**  
   Replace ExternalProject with `http_archive` (or rules_foreign_cc) for flatbuffers, ankerl, rapidjson, gtest, gflags, benchmark, rapidyaml, duckdb. Get `dashql` and the **native** tests/benchmarks/tools building and passing.

4. **WASM toolchain**  
   Register a WASM/WASI toolchain and build `dashql_core.wasm` with the same flags and exports as today.

5. **Binaryen integration**  
   Add the Binaryen repo (prebuilt) and the post-processing genrule for optimized WASM (and optionally source map for debug).

6. **CI / Makefile**  
   Replace `make core_native_*` and `make core_wasm_*` (and any direct CMake invocations) with Bazel commands. Keep or remove CMake in a follow-up once Bazel is authoritative.

---

## Files and locations to keep in mind

- **Grammar inputs**: `grammar/` at repo root (prologue, epilogue, precedences, lists, rules, scanner.l).  
- **Generated parser**: logically under `include/dashql/parser/` (scanner_generated.cc, parser_generated.cc, parser_generated.h).  
- **FlatBuffers**: generated C++ under `include/dashql/buffers/` (from `make flatbuf`); you may keep FlatBuffer code generation outside Bazel or move it into a genrule.  
- **WASM exports**: long list of `-Wl,--export=...` in root `CMakeLists.txt`; same list must be passed in the Bazel WASM link step.  
- **Binaryen**: used only in `scripts/build_core_wasm.sh`; no CMake target.  
- **GRAMMAR_DELIMITER**: Set in CMake but never used in the custom command; can be ignored in Bazel.

This gives you a clear path: grammar and deps in Bazel first (native), then WASM toolchain, then Binaryen post-processing, with minimal invasion of the rest of the repo.
