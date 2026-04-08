# Tauri ACL Generation Under Bazel

## Architecture

Tauri's `generate_context!()` proc macro requires two JSON files in `OUT_DIR`:
- `acl-manifests.json` — merged permission manifests from all plugins and core modules
- `capabilities.json` — resolved capabilities referencing those permissions

Normally, `tauri_build::try_build()` generates these files by reading plugin
permissions via `DEP_*_PERMISSION_FILES_PATH` environment variables. Under Bazel,
this mechanism broke because those env vars contain absolute sandbox paths that
become stale across action boundaries and remote cache restores.

## Solution — Pre-generate ACL files in Bazel

Instead of relying on `try_build()` and its `DEP_*` env var mechanism, we
pre-generate the ACL JSON files in a dedicated Bazel action with properly
declared inputs. This eliminates all sandbox path issues by design.

### Components

**`tauri-aclgen` binary** (`packages/tauri-aclgen/`)

A Rust binary that uses `tauri_utils::acl::build` functions directly to:
1. Generate core permissions from `acl_core_permissions.toml` (mirrors tauri's
   hardcoded `PLUGINS` constant) using `autogenerate_command_permissions()`
   and `define_permissions()`
2. Parse plugin permission TOMLs from external crate sources
3. Build merged `Manifest` objects for all plugins and core modules
4. Parse capabilities from `acl_capabilities.json`
5. Write `acl-manifests.json` and `capabilities.json` to the output directory

**`gen_tauri_acl` Starlark rule** (`packages/tauri-aclgen/tauri_acl.bzl`)

A custom Bazel rule that:
- Accepts plugin permission filegroups via `label_keyed_string_dict`
- Accepts core config and capability files
- Runs the `tauri-aclgen` binary with proper input declarations
- Outputs a TreeArtifact directory containing the JSON files

**`acl_core_permissions.toml`** (`packages/dashql-native/acl_core_permissions.toml`)

Configuration file mirroring the `PLUGINS` constant from `tauri` 2.10.3's
`build.rs`. Lists all core modules (path, event, window, webview, app, image,
resources, menu, tray) and their commands with default-enabled flags. Must be
updated when upgrading the tauri crate version.

### Data flow

```
Plugin crate repos (permissions/**/*.toml)
  + acl_core_permissions.toml
  + acl_capabilities.json
       │
       ▼
  tauri-aclgen binary (Bazel action with declared inputs)
       │
       ▼
  TreeArtifact: tauri_acl/
    ├── acl-manifests.json
    └── capabilities.json
       │
       ▼
  cargo_build_script (build.rs copies files to OUT_DIR)
       │
       ▼
  generate_context!() reads from OUT_DIR
```

### Plugin permission exposure

Each tauri plugin crate gets a `permission_files` filegroup via
`additive_build_file_content` annotations in `MODULE.bazel`:

```python
filegroup(
    name = "permission_files",
    srcs = glob(["permissions/**/*.toml"]),
    visibility = ["//visibility:public"],
)
```

Individual crate repos are registered in `use_repo()` so BUILD files can
reference them (e.g. `@crates__tauri-plugin-updater-2.10.0//:permission_files`).

### build.rs

The build script is now ~90 lines. Under Bazel, it simply copies the
pre-generated ACL files from `TAURI_ACL_DIR` to `OUT_DIR` and sets cfg flags.
No sandbox path remapping is needed.

## Historical Context

Before this refactor, `build.rs` contained ~150 lines of path remapping logic
(`remap_sandbox_path`, `remap_all_sandbox_paths`, `remap_repo_cache_paths`,
`find_in_external`, `find_in_repo_cache`, `rewrite_permission_env_vars`) to
work around two classes of stale paths:

1. **Stale `bazel-out/` sandbox prefixes** — absolute paths baked by plugin
   build scripts in one sandbox becoming invalid in the `dashql-native`
   build script's sandbox.
2. **Cached `~/.cache/bazel-repo/contents/` paths** — UUID-specific paths
   from remote cache entries produced by different CI runners.

These workarounds were fragile and difficult to maintain. The pre-generation
approach eliminates the root cause entirely.

## Maintenance

When upgrading tauri:
1. Compare `acl_core_permissions.toml` against the `PLUGINS` constant in
   `tauri`'s `build.rs` — update if commands were added/removed.
2. Update plugin crate version suffixes in `MODULE.bazel` `use_repo()` and
   `BUILD.bazel` plugin labels.

## Files

| File | Role |
|---|---|
| `packages/tauri-aclgen/src/main.rs` | ACL generation binary (`tauri-aclgen`) |
| `packages/tauri-aclgen/tauri_acl.bzl` | Bazel rule definition |
| `packages/dashql-native/acl_core_permissions.toml` | Core module command config |
| `packages/dashql-native/acl_capabilities.json` | Capability definitions |
| `packages/dashql-native/build.rs` | Copies pre-generated ACL files to OUT_DIR |
| `packages/dashql-native/BUILD.bazel` | `gen_tauri_acl` rule + `cargo_build_script` targets |
| `MODULE.bazel` | Plugin crate annotations + `use_repo` for permission access |
