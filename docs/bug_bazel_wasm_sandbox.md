This file is agent-generated.

# WASM build and sandbox (why `spawn_strategy=local` is required)

Building the WASM target with the default sandbox fails with:

```
absolute path inclusion(s) found in rule '...':
the source file '...' includes the following non-builtin files with absolute paths
(if these are builtin files, make sure these paths are in your toolchain):
  '/path/to/sandbox/.../execroot/_main/external/+dashql_core_dependencies+wasi_sdk/share/wasi-sysroot/...'
```

This document summarizes the cause and what was tried so we can remove `spawn_strategy=local` if Bazel or the toolchain changes.

## Cause

1. **How validation works**  
   After each C++ compile, Bazel parses the `.d` file and checks every included path. Paths under the exec root are allowed; paths that look “absolute” are allowed only if they match **permitted system include prefixes** (the toolchain’s builtin include dirs).

2. **Where the mismatch comes from**  
   - The WASI wrapper passes `--sysroot=<absolute path>` so clang finds headers. Clang then writes **absolute** paths into the `.d` file (the sandbox path, e.g. `.../sandbox/.../execroot/_main/external/...+wasi_sdk/...`).  
   - `CppCompileAction.getPermittedSystemIncludePrefixes()` in Bazel only adds **absolute** entries from `getBuiltInIncludeDirectories()`. Our toolchain config uses **relative** paths (e.g. `external/+dashql_core_dependencies+wasi_sdk/share/wasi-sysroot/...`), so the permitted list for this toolchain is empty.  
   - In `HeaderDiscovery.runDiscovery()`, an absolute path from the `.d` file is allowed only if it is under `execRoot` or under one of `permittedSystemIncludePrefixes`. The `.d` paths are **sandbox**-absolute; the `execRoot` used after the spawn is the **real** exec root. So `execPath.startsWith(execRoot)` is false, and we hit “absolute path inclusion”.

3. **Relevant issues**  
   - [rules_cc #277](https://github.com/bazelbuild/rules_cc/issues/277): allowlist / non-absolute builtin include dirs.  
   - [Pigweed blog](https://pigweed.dev/blog/09-bazel-relative-toolchain-paths.html): keeping toolchain paths relative so `.d` files stay relative.

## What was tried

1. **Relative `--sysroot` in the wrapper**  
   Use only relative paths (e.g. `REL_REPO_ROOT="$(dirname "$(dirname "$0")")"`, `--sysroot="$REL_REPO_ROOT/share/wasi-sysroot"`, `exec "$REL_REPO_ROOT/bin/clang++" ...`) so clang never sees an absolute sysroot and should emit relative paths in `.d` files.  
   - **Root cause**: Clang resolves a **relative** `--sysroot` relative to the **compiler binary’s directory**, not the current working directory (see `clang/lib/Driver/Driver.cpp`: relative `SysRoot` is prepended with `Dir` = `parent_path(ClangExecutable)`). So when we pass `--sysroot="external/+dashql_core_dependencies+wasi_sdk/share/wasi-sysroot"` (relative to cwd = exec root), clang resolves it from `.../bin/` and looks for `.../bin/external/.../share/wasi-sysroot`, which is wrong → `'algorithm'` (and other headers) not found.  
   - **Binary-relative sysroot**: Passing `--sysroot="../share/wasi-sysroot"` (relative to `bin/`) makes clang resolve to the correct sysroot; C++ headers are then found. With that change we got past `<algorithm>` but then hit `'stdlib.h' file not found`. The C library header lives under `<sysroot>/include/wasm32-wasi/` (target-specific C headers); that path is not added by clang’s sysroot handling for this target in the same way as C++.  
   - **Fix for stdlib.h (when using relative sysroot)**: add an explicit `-isystem <sysroot>/include/wasm32-wasi` so C headers are on the include path. **Order matters**: libc++ requires C++ Standard Library headers to be searched *before* C Standard Library headers (see e.g. `<cstdint>` including `<stdint.h>`). So any `-isystem` for `include/wasm32-wasi` must appear *after* the C++ include paths (e.g. after `include/c++/v1` / sysroot-derived C++ paths), not before. With absolute `--sysroot` only (no extra `-isystem`), clang’s default search order is correct and both C++ and C headers are found.  
   - Reverting to absolute `--sysroot` (no extra `-isystem`) fixes header resolution; then `.d` files are absolute again and validation fails in sandbox.

2. **`-nostdinc` + `-isystem` from the toolchain**  
   Drop `--sysroot` in the wrapper and add a toolchain feature that passes `-nostdinc` and `-isystem <repo_root>/share/wasi-sysroot/...` (exec-root-relative) so builtin includes are explicit and relative.  
   - Result: Compile command does get the `-isystem` flags with the correct paths (e.g. `external/+dashql_core_dependencies+wasi_sdk/share/wasi-sysroot/include/c++/v1`), but clang still fails to find `<algorithm>` / `<span>` etc. So header resolution fails (and we did not get to sandbox validation). Retried with full include list (c++/v1, wasm32-wasi, include, clang resource) in correct order—same outcome. So there is currently **no way** to make the WASI SDK work with the sandbox without a Bazel/rules_cc change.

3. **`-no-canonical-prefixes`**  
   Already used; it does not stop clang from writing absolute paths when `--sysroot` is absolute.

4. **Bazel / rules_cc changes**  
   - Making `getPermittedSystemIncludePrefixes()` also add `execRoot.getRelative(fragment)` for **relative** builtin dirs would allow `.d` paths that are under the real exec root to match.  
   - Or: when validating `.d` contents after a sandbox spawn, relativize paths under the **sandbox** exec root before comparing to the real exec root / builtin dirs.  
   - No local workaround was found that avoids changing Bazel or the toolchain’s path handling.

## Verification (with `--config=wasm`)

Only the following need to work; do **not** run `//packages/dashql-core:all` with `--config=wasm` (native and wasm targets are mixed there).

- **Build**: `bazel build //packages/dashql-core-api:dist_wasm //packages/dashql-core-api:dist_wasm_opt --config=wasm` must succeed (this builds the WASM core and the core-api dist that uses it).
- **Core-api tests**: They consume the wasm-built dist. Running `bazel test //packages/dashql-core-api:tests ...` with `--config=wasm` fails (test execution platform becomes wasm32, no shell toolchain). Run the tests via the app’s test path (e.g. `make core_js_tests` or equivalent) which builds wasm then runs Jest on the host.

## Current workaround

- **`.bazelrc`**  
  The `wasm` config sets `build:wasm --spawn_strategy=local` so WASM builds run without the sandbox.  
  Then the `.d` file paths are under the real exec root, so `execPath.startsWith(execRoot)` holds and validation passes.

- **Removing it later**  
  When either (a) Bazel/rules_cc support relative builtin dirs in the allowlist, or (b) we have a wrapper/toolchain setup that makes clang emit only relative paths and still find all headers under sandbox, we can drop `build:wasm --spawn_strategy=local` and rely on the default spawn strategy.
