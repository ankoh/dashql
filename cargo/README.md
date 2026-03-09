# Cargo workspaces

Rust is split into two workspaces so that **dashql-compute** (WASM) is not forced to share dependency resolution with **dashql-native** and **dashql-pack** (native). That way the WASM lockfile does not pull in e.g. `tokio` with `"rt"` → `mio`, which does not support `wasm32-unknown-unknown`.

| Workspace   | Manifest                          | Members                    | Use for                          |
|------------|-----------------------------------|----------------------------|-----------------------------------|
| **Native** | `Cargo.toml` (repo root)          | dashql-native, dashql-pack | Native builds, Tauri, pack tool   |
| **Compute**| `packages/dashql-compute/Cargo.toml` | dashql-compute only     | Bazel crate_universe (WASM)       |

- **Build native:**  
  `cargo build -p dashql-pack --release`  
  (or `-p dashql-native`)

- **Build / test compute (host):**  
  `cargo build --manifest-path packages/dashql-compute/Cargo.toml`  
  `cargo test --manifest-path packages/dashql-compute/Cargo.toml`

- **Build compute for WASM:**  
  `bazel build //packages/dashql-compute:dist` (debug) or `bazel build //packages/dashql-compute:dist --config=release` (optimized). Output is in `bazel-bin/.../dist_pkg`.

Bazel uses two isolated crate universes (see `MODULE.bazel`):
- `@crates//` — native workspace (root `Cargo.toml` / `Cargo.lock`)
- `@compute_crates//` — compute workspace (`packages/dashql-compute/Cargo.toml` / `Cargo.lock`)

After changing dependencies, repin with:  
`CARGO_BAZEL_REPIN=1 bazel build @crates//:all`  
`CARGO_BAZEL_REPIN=1 bazel build @compute_crates//:all`
