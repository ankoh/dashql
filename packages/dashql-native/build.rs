/// Replace a stale Bazel sandbox path prefix with the current exec root.
/// Paths containing `bazel-out/` get their prefix replaced; others pass through.
fn remap_sandbox_path(path: &str, exec_root: &str) -> String {
    match path.find("bazel-out/") {
        Some(i) => format!("{}{}", exec_root, &path[i..]),
        None => path.to_string(),
    }
}

/// Fix all DEP_*_PERMISSION_FILES_PATH env vars so tauri_build can resolve them.
///
/// Each env var points to a JSON index file containing `["<path>.toml", ...]`.
/// Both the env var value and the paths inside the JSON can contain stale Bazel
/// sandbox prefixes. We remap them to the current exec root, write corrected
/// copies to OUT_DIR, and update the env vars.
fn rewrite_permission_env_vars(exec_root: &str, out_dir: &str) {
    for (key, value) in std::env::vars() {
        if !key.starts_with("DEP_") || !key.ends_with("_PERMISSION_FILES_PATH") {
            continue;
        }
        let json_path = remap_sandbox_path(&value, exec_root);
        if let Ok(contents) = std::fs::read_to_string(&json_path) {
            let fixed = remap_all_sandbox_paths(&contents, exec_root);
            let fixed_file = std::path::Path::new(out_dir).join(format!("fixed-{key}"));
            if std::fs::write(&fixed_file, &fixed).is_ok() {
                std::env::set_var(&key, &fixed_file);
            }
        }
    }
}

/// Replace every absolute-path prefix before `bazel-out/` in `text` with `exec_root`.
/// Works on raw JSON strings: finds `bazel-out/` markers and replaces the preceding
/// path segment (back to the enclosing `"`) with the current exec root.
fn remap_all_sandbox_paths(text: &str, exec_root: &str) -> String {
    const MARKER: &str = "bazel-out/";
    let mut result = String::with_capacity(text.len());
    let mut pos = 0;

    while let Some(marker_offset) = text[pos..].find(MARKER) {
        let marker_abs = pos + marker_offset;
        // Find the start of this path: scan backwards from the marker for `"`.
        let path_start = text[pos..marker_abs]
            .rfind('"')
            .map(|q| pos + q + 1)
            .unwrap_or(marker_abs);
        // Everything before the path start is unchanged.
        result.push_str(&text[pos..path_start]);
        // Insert the current exec root in place of the stale prefix.
        result.push_str(exec_root);
        // Continue from the "bazel-out/" marker; write the marker itself and
        // advance past it to avoid finding it again.
        result.push_str(MARKER);
        pos = marker_abs + MARKER.len();
    }
    result.push_str(&text[pos..]);
    result
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by Cargo/Bazel");

    let (proto_files, include_dirs): (Vec<String>, Vec<String>) =
        if let Ok(hyper_proto) = std::env::var("PROTO_HYPER_SERVICE") {
            let test_proto = std::env::var("PROTO_TEST_SERVICE").expect("PROTO_TEST_SERVICE");
            // Derive proto root: hyper_service.proto is under salesforce/hyperdb/grpc/v1/,
            // so go up 5 levels (filename + 4 package components) to reach the proto root.
            let include = std::path::Path::new(&hyper_proto)
                .parent().and_then(|p| p.parent())
                .and_then(|p| p.parent()).and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| ".".into());
            (vec![hyper_proto, test_proto], vec![include])
        } else {
            println!("cargo:rerun-if-changed=../../proto/pb/salesforce/hyperdb/grpc/v1/hyper_service.proto");
            println!("cargo:rerun-if-changed=../../proto/pb/dashql/test/test_service.proto");
            (
                vec![
                    "../../proto/pb/salesforce/hyperdb/grpc/v1/hyper_service.proto".into(),
                    "../../proto/pb/dashql/test/test_service.proto".into(),
                ],
                vec!["../../proto/pb/".into()],
            )
        };

    tonic_prost_build::configure()
        .out_dir(&out_dir)
        .compile_protos(&proto_files, &include_dirs)?;

    let is_bazel = std::env::var("PROTO_HYPER_SERVICE").is_ok();
    if is_bazel {
        // Run tauri_build to generate ACL manifests and capabilities in OUT_DIR.
        // Without these files, generate_context!() embeds an empty permission set
        // and all IPC commands (including data-tauri-drag-region window dragging)
        // are silently denied at runtime.
        //
        // DEP_*_PERMISSION_FILES_PATH env vars come from link_deps in BUILD.bazel.
        // They point to JSON index files listing absolute paths to TOML permission
        // files. Both layers can contain stale Bazel sandbox paths that need to be
        // remapped to the current exec root before try_build() can read them.
        let exec_root = out_dir
            .find("bazel-out/")
            .map(|i| &out_dir[..i])
            .unwrap_or("");

        if !exec_root.is_empty() {
            rewrite_permission_env_vars(exec_root, &out_dir);
        }

        if let Err(e) = tauri_build::try_build(tauri_build::Attributes::default()) {
            println!("cargo:warning=tauri_build::try_build failed: {e:#}");
        }

        // Cfg flags not set by try_build (duplicates from try_build are harmless).
        println!("cargo:rustc-check-cfg=cfg(desktop)");
        println!("cargo:rustc-cfg=desktop");
        println!("cargo:rustc-check-cfg=cfg(mobile)");
        println!("cargo:rustc-check-cfg=cfg(dev)");
        println!("cargo:rustc-check-cfg=cfg(bazel)");
        println!("cargo:rustc-cfg=bazel");
        if std::env::var("DEP_TAURI_DEV").as_deref() == Ok("true") {
            println!("cargo:rustc-cfg=dev");
        }
        let target = std::env::var("TARGET").unwrap_or_default();
        println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE={target}");

        // When compile_data contains generated files, rules_rust's transform_sources
        // symlinks all source files into the output tree. But CARGO_MANIFEST_DIR still
        // points to the source tree, so the Tauri proc macro can't find anything.
        // Override CARGO_MANIFEST_DIR to the output tree directory (derived from OUT_DIR
        // which is <output_tree>/build_script.out_dir). The build script runner's
        // redact_exec_root replaces the sandbox-absolute prefix with ${pwd}, and the
        // process wrapper re-expands it in the compilation sandbox.
        let new_manifest = std::path::Path::new(&out_dir)
            .parent()
            .expect("OUT_DIR parent");
        println!(
            "cargo:rustc-env=CARGO_MANIFEST_DIR={}",
            new_manifest.display()
        );
    } else {
        // Cargo: ensure gen/schemas/ exists (tauri_build writes schema files there on first build).
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            std::fs::create_dir_all(
                std::path::Path::new(&manifest_dir).join("gen").join("schemas"),
            ).ok();
        }
        tauri_build::build();
    }
    Ok(())
}
