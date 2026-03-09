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

    tonic_build::configure()
        .out_dir(&out_dir)
        .compile(&proto_files, &include_dirs)?;

    let is_bazel = std::env::var("PROTO_HYPER_SERVICE").is_ok();
    if is_bazel {
        // Bazel: tauri_build::build() reads plugin permission files via absolute sandbox paths
        // from other crates' build scripts, which are invalid across sandbox boundaries.
        // Set the required cfg/env vars manually instead. The codegen proc macro gracefully
        // defaults to empty ACL manifests when the files are absent from OUT_DIR.
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
        println!("cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_APP_NAME=dashql");
        println!("cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_PREFIX=app");

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
