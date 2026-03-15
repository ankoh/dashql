use prost_build::Config;
use regex::Regex;

fn version_rs_from_git() -> anyhow::Result<String> {
    let raw_commit = std::process::Command::new("git")
        .args(&["log", "-1", "--format=%h"])
        .output()?.stdout;
    let raw_tag = std::process::Command::new("git")
        .args(&["describe", "--tags", "--abbrev=0"])
        .output()?.stdout;
    let raw_describe = std::process::Command::new("git")
        .args(&["describe", "--tags", "--long"])
        .output()?.stdout;
    let commit = std::str::from_utf8(&raw_commit)?.trim().to_string();
    let tag = std::str::from_utf8(&raw_tag)?.trim().to_string();
    let describe = std::str::from_utf8(&raw_describe)?.trim().to_string();

    let tag_cap = Regex::new("v([0-9]+)\\.([0-9]+)\\.([0-9]+)")?.captures(&tag)
        .ok_or_else(|| anyhow::anyhow!("failed to parse git tag"))?;
    let major: u32 = tag_cap[1].parse()?;
    let minor: u32 = tag_cap[2].parse()?;
    let mut patch: u32 = tag_cap[3].parse()?;

    let dev: u32 = Regex::new(".*-([0-9]+)-.*")?.captures(&describe)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0);
    if dev > 0 { patch += 1; }
    let text = if dev == 0 {
        format!("{}.{}.{}", major, minor, patch)
    } else {
        format!("{}.{}.{}-dev.{}", major, minor, patch, dev)
    };

    Ok(format!(
        "// @generated\npub static DASHQL_VERSION_MAJOR: u32 = {major};\n\
         pub static DASHQL_VERSION_MINOR: u32 = {minor};\n\
         pub static DASHQL_VERSION_PATCH: u32 = {patch};\n\
         pub static DASHQL_VERSION_DEV: u32 = {dev};\n\
         pub static DASHQL_VERSION_COMMIT: &str = \"{commit}\";\n\
         pub static DASHQL_VERSION_TEXT: &str = \"{text}\";\n",
        major = major, minor = minor, patch = patch, dev = dev,
        commit = commit, text = text,
    ))
}

fn main() -> anyhow::Result<()> {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by Cargo/Bazel");
    let version_out = std::path::Path::new(&out_dir).join("version.rs");

    // Under Bazel: DASHQL_VERSION_RS is the execpath of the generated version.rs artifact.
    // Under plain Cargo: generate the same content from git describe.
    if let Ok(src) = std::env::var("DASHQL_VERSION_RS") {
        std::fs::copy(&src, &version_out)?;
    } else {
        std::fs::write(&version_out, version_rs_from_git()?)?;
    }

    // Proto: use OUT_DIR so both Cargo and Bazel work. Under Bazel, PROTO_COMPUTE_PROTO is the path to compute.proto.
    let (proto_files, include_dirs): (Vec<String>, Vec<String>) =
        if let Ok(compute_proto) = std::env::var("PROTO_COMPUTE_PROTO") {
            let path = std::path::Path::new(&compute_proto);
            // compute.proto is in .../dashql/compute/; proto root is .../ (parent of dashql).
            let include = path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| std::env::var("PROTO_INCLUDE").unwrap_or_else(|_| ".".into()));
            (vec![compute_proto], vec![include])
        } else {
            println!("cargo:rerun-if-changed=../../proto/pb/dashql/compute/compute.proto");
            (
                vec!["../../proto/pb/dashql/compute/compute.proto".into()],
                vec!["../../proto/pb/".into()],
            )
        };

    Config::new()
        .out_dir(&out_dir)
        .compile_protos(proto_files.iter().map(String::as_str).collect::<Vec<_>>().as_slice(), &include_dirs)?;
    Ok(())
}
