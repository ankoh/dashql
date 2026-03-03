# Cargo workspaces

Rust is split into two workspaces so that **dashql-compute** (WASM) is not forced to share dependency resolution with **dashql-native** and **dashql-pack** (native). That way the WASM lockfile does not pull in e.g. `tokio` with `"rt"` → `mio`, which does not support `wasm32-unknown-unknown`.

| Workspace   | Manifest              | Members                    | Use for                          |
|------------|------------------------|----------------------------|-----------------------------------|
| **Native** | `cargo/native/Cargo.toml` | dashql-native, dashql-pack | Native builds, Tauri, pack tool   |
| **Root**   | `Cargo.toml` (repo root)  | dashql-compute only        | Bazel crate_universe              |

- **Build native:**  
  `cargo build --manifest-path cargo/native/Cargo.toml -p dashql-pack --release`  
  (or `-p dashql-native`)

- **Build / test compute (host):**  
  `cargo build -p dashql-compute` / `cargo test -p dashql-compute` (from repo root)

- **Build compute for WASM:**  
  `bazel build //packages/dashql-compute:dist --config=compute` (then copy from `bazel-bin/.../dist_dist_opt` to `packages/dashql-compute/dist`), or use `make compute_wasm_o3`.

Bazel’s crate_universe uses the **root** workspace (`//:Cargo.toml`, `//:Cargo.lock`). After changing root `Cargo.toml` or `Cargo.lock`, run:  
`CARGO_BAZEL_REPIN=1 bazel sync --only=crates`.
