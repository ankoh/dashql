/// Copy pre-generated ACL files from the tauri-aclgen output directory to OUT_DIR.
fn copy_acl_files(out_dir: &str) {
    let acl_dir = std::env::var("TAURI_ACL_DIR").unwrap_or_else(|_| {
        panic!(
            "build.rs: TAURI_ACL_DIR not set — \
             the Bazel tauri-aclgen rule must provide it"
        )
    });
    let acl_path = std::path::Path::new(&acl_dir);
    let out_path = std::path::Path::new(out_dir);
    for name in ["acl-manifests.json", "capabilities.json"] {
        let src = acl_path.join(name);
        let dst = out_path.join(name);
        std::fs::copy(&src, &dst).unwrap_or_else(|e| {
            panic!("build.rs: failed to copy {} -> {}: {e}", src.display(), dst.display())
        });
    }
    // allowed-commands.json is optional (only generated when REMOVE_UNUSED_COMMANDS is set).
    let allowed = acl_path.join("allowed-commands.json");
    if allowed.exists() {
        std::fs::copy(&allowed, out_path.join("allowed-commands.json")).ok();
    }
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
        // Copy pre-generated ACL files from the tauri-aclgen Bazel rule into
        // OUT_DIR where generate_context!() expects them. This replaces the
        // previous approach of calling tauri_build::try_build() with complex
        // sandbox path remapping (see docs/agents/investigation_tauri_sandbox.md).
        copy_acl_files(&out_dir);

        // Cfg flags for Tauri conditional compilation.
        println!("cargo:rustc-check-cfg=cfg(desktop)");
        println!("cargo:rustc-cfg=desktop");
        println!("cargo:rustc-check-cfg=cfg(mobile)");
        println!("cargo:rustc-check-cfg=cfg(dev)");
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
