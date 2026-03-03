This file is agent-generated.

# WASM build and sandbox (why no-sandbox is required for wasm actions)

Building the WASM target with the default sandbox fails with:

```
absolute path inclusion(s) found in rule '...':
the source file '...' includes the following non-builtin files with absolute paths
(if these are builtin files, make sure these paths are in your toolchain):
  '/path/to/sandbox/.../execroot/_main/external/+dashql_core_dependencies+wasi_sdk/share/wasi-sysroot/...'
```

This document summarizes the cause and what was tried so we can remove the no-sandbox workaround if Bazel or the toolchain changes.

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

## Other projects and the sandbox

Few projects document a Bazel + WASI SDK setup like ours (download prebuilt SDK, wrapper script, custom `cc_toolchain`). What exists:

- **nullcatalyst/wasmtoolchain**: C/C++ → WebAssembly toolchain for Bazel. Uses the old `--crosstool_top` / `--cpu=wasm32` API and ships a **minimal bundled** libc/libc++ and clang in the repo, so it may not use `--sysroot` the same way. No mention of sandbox or `spawn_strategy` in the repo; they may hit the same issue if they ever switch to a sysroot-based layout.
- **proxy-wasm-cpp-sdk** (BCR): Uses **Emscripten (emsdk)** for C++ → wasm, not the WASI SDK. Different toolchain and sandbox behavior.
- **rules_cc #277** and related: The same “absolute path inclusion” failure affects many custom/rule-based C++ toolchains (Clang, Bootlin GCC, etc.) when builtin include dirs are relative or from external repos. So we are not alone; the underlying limitation is in Bazel/rules_cc.
  - **Workarounds** reported in that issue: (1) **`spawn_strategy=local`** (what we use), (2) for **Clang**: passing **`-resource-dir`** and **`-ccc-install-dir`** with *relative* paths can make clang emit relative paths in `.d`. In [this comment](https://github.com/bazelbuild/rules_cc/issues/277#issuecomment-219723789) the author shows that with Fuchsia/LLVM clang 19 the following yields *relative* include search paths (and thus relative paths in `.d` files):
    ```bash
    # From exec root (cwd); paths stay relative in the “#include <...> search starts here” output
    external/+_repo_rules+clang-linux-x86_64/bin/clang -E -x c++ - -v \
      -resource-dir=external/+_repo_rules+clang-linux-x86_64/lib/clang/19 \
      -ccc-install-dir external/+_repo_rules+clang-linux-x86_64/bin < /dev/null
    ```
    The flags are the standard **single-dash** form (`-resource-dir`, `-ccc-install-dir`); Clang’s [command-line reference](https://clang.llvm.org/docs/ClangCommandLineReference.html) documents `-resource-dir` / `-resource-dir=`. If a given clang build rejects them, trying `--resource-dir` / `--ccc-install-dir` is possible but non-standard. **Tried for WASI SDK**: an earlier attempt reported **`unsupported option '-ccc-install-dir'`** (possibly due to how the wrapper passed paths or an older SDK). The current WASI SDK 22 (Clang 18.1.2) **does** accept both `-resource-dir` and `-ccc-install-dir`. The flags are **single-dash** only; `-ccc-install-dir` does not appear in `clang --help` for this build but is accepted at compile time.

  - **Why it didn’t work for us**  
  For the workaround to succeed, *every* builtin include path that ends up in the `.d` file must be relative—not only the resource dir and install dir, but also the **sysroot** (libc++, wasm32-wasi C headers, etc.). Our wrapper sets `--sysroot="$SYSROOT"` with `SYSROOT` from `$(dirname "$0")` and `pwd`, i.e. an **absolute** path. So even if we passed `-ccc-install-dir` and `-resource-dir` with relative paths (e.g. from the toolchain, which knows the exec-root-relative repo path), the sysroot-derived includes would still be written as absolute in the `.d` file and sandbox validation would still fail. Making `--sysroot` relative (e.g. `--sysroot=../share/wasi-sysroot` from the wrapper so it’s relative to the compiler binary) was tried in “What was tried” §1: C++ headers were found but C’s `stdlib.h` was not, because for this target clang doesn’t add `<sysroot>/include/wasm32-wasi` the same way; fixing that with an extra `-isystem` and correct include order is possible in principle but was not completed. So we never had a configuration where sysroot, resource dir, and install dir were all relative at once; the “unsupported option” may have been from passing an absolute path to `-ccc-install-dir` in the wrapper or from an older SDK.

  - **Worth trying again?**  
  Only if we close the one gap that was never fully tested: use **binary-relative** `--sysroot=../share/wasi-sysroot` in the wrapper, add **`-isystem`** for C headers if needed (correct order), and have the **toolchain** pass **`-ccc-install-dir`** and **`-resource-dir`** with the exec-root-relative repo path.

  - **Experiment (done)**  
  From the WASI SDK `bin/` directory, compile a file that includes `<cstdint>` with `--sysroot=../share/wasi-sysroot`, `-resource-dir=../lib/clang/18`, and `-MD`. **Result:** the generated `.d` file contains **relative** paths (`../share/wasi-sysroot/...`, `../lib/clang/18/...`), not absolute. So clang does *not* resolve these to absolute before writing the `.d`; the paths are relative to the **current working directory** at compile time.

  - **Attempt: toolchain passes exec-root-relative flags (failed)**  
  The toolchain was changed to pass `--sysroot=%{sysroot}`, `-resource-dir=%{sysroot}/../lib/clang/18`, and `-ccc-install-dir %{sysroot}/../bin` for compile actions (with `%{sysroot}` = exec-root-relative repo path), and the wrapper was changed to *not* pass `--sysroot`. **Result:** clang could not find `<string>` (and other C++ headers). **Cause:** Clang resolves a **relative** `--sysroot` relative to the **compiler binary’s directory**, not the current working directory (see [Clang docs](https://releases.llvm.org/19.1.0/tools/clang/docs/CrossCompilation.html) and Driver.cpp). So when the toolchain passed `--sysroot=external/.../share/wasi-sysroot` (relative to exec root / cwd), clang resolved it from `.../bin/` and looked for `.../bin/external/...`, which does not exist. So we cannot get both (1) headers found and (2) exec-root-relative paths in the `.d` by passing `--sysroot` from the toolchain. Reverted to wrapper passing absolute `--sysroot` and no-sandbox.

  - (3) Invoking the real compiler binary via a path that stays under the exec root (e.g. `./external/.../bin/clang`) so the driver sees relative install dirs.
  - Upstream work: [Bazel #25783](https://github.com/bazelbuild/bazel/issues/25783) (allowlist with relative paths), [rules_cc PR #450](https://github.com/bazelbuild/rules_cc/pull/450) (raw_allowlist_include_directories). A proper fix will likely come from Bazel or rules_cc, not from toolchain tweaks alone.

## Alternative solutions (from other projects)

Investigation of how others handle the same or related sandbox/absolute-path issue:

- **[Bazel #25783](https://github.com/bazelbuild/bazel/issues/25783)**  
  Same setup: WASI SDK (or similar) in an `http_archive`, `allowlist_include_directories` with a `DirectoryInfo` from that repo. Bazel ignores non-absolute prefixes in `getPermittedSystemIncludePrefixes`, so the allowlist is effectively empty. **No workaround** is given in the issue; it is a feature request. Author is from [vimana-cloud/rules_wasm](https://github.com/vimana-cloud/rules_wasm).

- **[Pigweed blog: “Satisfying Bazel’s relative paths requirement”](https://pigweed.dev/blog/09-bazel-relative-toolchain-paths.html)**  
  - Use **`-no-canonical-prefixes`** (we already do); for “well-behaving” toolchains this can be enough.  
  - **Invoke the compiler with a relative path** (e.g. `external/.../bin/clang++`) so the driver sees a relative install dir; we do that when not using `pwd`, but header resolution then failed.  
  - If the wrapper still causes absolute paths: **manually declare builtins with `-nostdinc` and `-isystem`** in the same order as the compiler’s builtin list. We tried that; clang did not find `<algorithm>` etc. with our exec-root-relative `-isystem` paths.  
  - For **known absolute paths** (e.g. macOS sysroot): use **`cc_args.allowlist_absolute_include_directories`** (rule-based) or `cxx_builtin_include_directories` with absolute strings. That does not help when builtins live in an external repo and we only have relative paths at config time.

- **[rules_cc PR #450](https://github.com/bazelbuild/rules_cc/pull/450) (merged)**  
  Adds **`allowlist_absolute_include_directories`** to `cc_args()` so rule-based toolchains can pass **absolute** path strings (validated as absolute). Useful for toolchains that know absolute paths (e.g. Apple). For an external repo we do not have absolute paths in Starlark, so this does not remove the need for `spawn_strategy=local` in our case.

- **[bazel-contrib/toolchains_llvm #426](https://github.com/bazel-contrib/toolchains_llvm/issues/426)**  
  “LLVM on disk” (`path = "/opt/llvm"`) randomly fails with the same “absolute path inclusion(s) found” error. No resolution in the issue; same underlying Bazel/rules_cc behavior.

- **[avrabe/rules_rust #4](https://github.com/avrabe/rules_rust/issues/4)**  
  WASI build failed with the same absolute-path inclusion error (WASI SDK headers). **Workaround used**: `--spawn_strategy=local`. **“Fix” in that repo**: for the specific `allocator_library` target they (1) removed the `#include` that pulled in system headers and used compiler builtins instead, and (2) for WASI set `srcs = []` so no C++ is compiled and no archiving is needed—sidestepping the problem for that one target, not a general toolchain fix.

**Conclusion:** No project provides a general alternative that makes a WASI SDK (or similar external-repo) C++ toolchain work under the sandbox. The only widely used workaround is **`spawn_strategy=local`**. Upstream fixes are tracked in rules_cc #277 and Bazel #25783.

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

## Verification

Do **not** run `//packages/dashql-core:all` with a wasm platform (native and wasm targets are mixed there).

- **Build**: `bazel build //packages/dashql-core-api:dist_wasm` and `bazel build //packages/dashql-core-api:dist_wasm_opt` must succeed (no `--config=wasm` needed; the `use_wasm32_platform` transition sets platform and no-sandbox).
- **Core-api tests**: `bazel test //packages/dashql-core-api:tests` builds the wasm dist via the same transition. Do **not** use `--config=wasm` for tests (test execution platform would become wasm32 and break).

## Current workaround

- **Transition in `use_wasm32_platform`**  
  The rule that wraps `dist_wasm` / `dist_wasm_opt` uses a transition that sets `//command_line_option:platforms` to `//bazel/platforms:wasm32` and appends `.*=+no-sandbox` to `//command_line_option:modify_execution_info`. So any build that depends on `dist_wasm` or `dist_wasm_opt` (e.g. building them, or running core-api tests) gets the wasm32 platform and no-sandbox only for that dependency subtree; the rest of the build stays sandboxed. With no-sandbox, the `.d` file paths are under the real exec root and validation passes.

- **No `.bazelrc` wasm config**  
  There is no `build:wasm` config; the transition is the single place that applies the no-sandbox modifier. For a direct build of a wasm target (e.g. `//packages/dashql-core:dashql_core_wasm`), pass `--platforms=//bazel/platforms:wasm32 --modify_execution_info=.*=+no-sandbox` on the command line.

- **Removing it later**  
  When either (a) Bazel/rules_cc support relative builtin dirs in the allowlist, or (b) we have a wrapper/toolchain setup that makes clang emit only relative paths and still find all headers under sandbox, we can drop the no-sandbox modifier and rely on the default spawn strategy.
