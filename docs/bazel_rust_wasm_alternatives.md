# Do we need wasm-pack? (Bazel + Rust → WASM alternatives)

## Short answer

**No** for a pure-Bazel path (we use platform transition + rust_shared_library + wasm-bindgen-cli + mio patch). **Yes** if you want package-scoped resolution without patching: then a Bazel rule that **invokes wasm-pack** for the one WASM crate is a valid and common pattern—see "What other projects do" below.

## The problem: one crate needs WASM, the whole workspace doesn't

We avoid this by **splitting Cargo into two workspaces**:

- **Root `Cargo.toml`** — member: dashql-compute only (used by Bazel crate_universe).
- **`cargo/native/Cargo.toml`** — members: dashql-native, dashql-pack (native only).

So dashql-compute is **not** in the same workspace as the native crates; the root lockfile has resolution scoped to that crate only (e.g. tokio without `"rt"` → no mio). See `cargo/README.md`.

**Why this matters:** With a single workspace, Cargo uses **one feature union** per crate: the union of what every workspace member needs. So if dashql-native and dashql-pack depended on tokio with `"rt"` (→ mio), the lockfile would have tokio with mio for everyone. There is **no per-target or per-package feature resolution** in crate_universe; the rules_rust maintainers have said a proper fix would require overriding metadata at resolution time ([rules_rust#3853](https://github.com/bazelbuild/rules_rust/issues/3853), [rules_rust#2779](https://github.com/bazelbuild/rules_rust/issues/2779)).

## What other projects do

1. **Split workspaces (what we do)**  
   Root workspace (dashql-compute only) + `cargo/native` (dashql-native, dashql-pack). Bazel's crate_universe uses root `Cargo.toml` and `Cargo.lock`, so the WASM build gets compute-only resolution (no mio).

2. **Patch / annotate in a single repo**  
   One `from_cargo` repo and patch crates that don't support wasm32 (e.g. mio). The whole graph is built for wasm when you build the WASM target.

3. **Second crate_universe repo with a WASM-only stub**  
   A separate `from_cargo` that uses a **stub** package (duplicated deps) so the lockfile is scoped to that crate. Downside: duplicate Cargo.toml and version drift.

4. **Run wasm-pack from Bazel for the WASM artifact**  
   Bazel runs `wasm-pack build` for the one package that needs WASM. Cargo does dependency resolution for that build only. Hybrid: Bazel invokes wasm-pack as the tool that produces the WASM output.

## How others do it (Bazel + Rust → WASM without wasm-pack)

1. **Platform transition to wasm**  
   Use `@rules_rust//rust/platform:wasm` (for `wasm32-unknown-unknown`) so the Rust toolchain builds for that target. This is done via a [configuration transition](https://bazel.build/extending/config#user-defined-transitions) that sets `//command_line_option:platforms` to the wasm platform.

2. **Build a Rust artifact for wasm**  
   - **rust_binary** with `crate_type = "cdylib"` (or **rust_shared_library**) so the output is a .wasm file.  
   - All Rust deps in the build graph are built for the wasm platform because of the transition.

3. **Generate JS/TS bindings**  
   Use rules_rust's **`rust_wasm_bindgen`** rule: it takes the .wasm file and runs the wasm-bindgen CLI to produce the JavaScript (and optionally TypeScript) glue.  
   - Repositories: `load("@rules_rust//wasm_bindgen:repositories.bzl", "rust_wasm_bindgen_repositories")` and call it from MODULE.bazel or workspace.  
   - The rule can take a `wasm_file` (e.g. the output of the cdylib build) and `target` (e.g. `"web"` or `"bundler"`).

4. **Optional: wasm-opt**  
   For size/speed, run Binaryen's **wasm-opt** on the .wasm (we already have a `binaryen` repo for dashql-core). This can be a separate Bazel action that consumes the wasm output and produces an optimized .wasm.

So the pipeline is: **Bazel (platform wasm) → rust_shared_library / rust_binary (cdylib) → .wasm → rust_wasm_bindgen → .wasm + .js** (and optionally → wasm-opt → optimized .wasm). No wasm-pack involved.

## Current implementation (wasm-pack removed)

We use **only the native Bazel path** for compute WASM:

- **`//packages/dashql-compute:dashql_compute_wasm`** – `rust_shared_library` (cdylib) built for wasm via platform transition to `@rules_rust//rust/platform:wasm`.
- **`//bazel:rust_wasm.bzl`** – `rust_wasm_dist` rule (generic): takes that .wasm, runs **wasm-bindgen-cli** (from `//bazel:external_wasm_bindgen.bzl`, prebuilt from GitHub), optionally runs **wasm-opt** (from `@binaryen//:wasm_opt`) for release, and produces a dist directory (same layout as before: `dashql_compute_bg.wasm`, `dashql_compute.js`, `package.json`).
- **`//packages/dashql-compute:dist`** (release + wasm-opt) and **`:dist_debug`** (no wasm-opt) use this rule. **wasm-pack is no longer used in Bazel.**

We use the **root workspace** for Bazel's crate_universe: `cargo_lockfile = "//:Cargo.lock"`, `manifests = ["//:Cargo.toml"]`. That lockfile has only dashql-compute and its deps (tokio without `"rt"` → no mio), so **no mio patch is required** for the WASM build.

**Repin required after lockfile changes:**  
`CARGO_BAZEL_REPIN=1 bazel sync --only=crates`  
(After changing root `Cargo.toml` or `Cargo.lock`.)

### Why do I see "[for tool]" and no "wasm" in the error?

Building `//packages/dashql-compute:dist` first builds the **host** (exec) side of the graph: build scripts and any crates needed to run them. Those show up as `[for tool]` in Bazel output. The **wasm32** build (your `rust_shared_library` and its deps) runs only after the host/tool part succeeds. So a failure in e.g. `ar_archive_writer [for tool]` is in the host build of a transitive, not in the wasm build. Fix: use a Rust toolchain that supports the syntax (we use 1.86.0 so edition‑2024 crates like `ar_archive_writer` 0.5.x compile).

### Can we use Rust 1.86 with rules_rust?

**Yes.** rules_rust does not maintain a fixed list of supported Rust versions. It accepts any version you pass in `rust.toolchain(versions = ["1.86.0"], ...)` and downloads that toolchain from `https://static.rust-lang.org/dist/` (see `DEFAULT_STATIC_RUST_URL_TEMPLATES` in rules_rust’s `repository_utils.bzl`). So 1.86.0 works with rules_rust as soon as that version is published on static.rust-lang.org. If the download fails (e.g. 1.86 not released yet), either use the latest stable that exists (e.g. 1.85.0) and accept possible E0658 in host/tool builds of edition‑2024 crates, or use a nightly toolchain until 1.86 is available.

## References

- [rules_rust: Building for WebAssembly](https://bazelbuild.github.io/rules_rust/) (platform `wasm`, `rust_wasm_bindgen`).
- [Stack Overflow: How do you build a Rust Wasm binary with Bazel?](https://stackoverflow.com/questions/78168400/how-do-you-build-a-rust-wasm-binary-with-bazel) – platform transition + `rust_binary` with `crate_type = "cdylib"`.
- Our crate is already `crate-type = ["cdylib"]` in Cargo.toml, so it's a natural fit for a `rust_shared_library` (or equivalent) under the wasm platform.
