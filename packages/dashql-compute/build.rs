use core::fmt;
use prost_build::Config;
use regex::Regex;

#[derive(Default)]
struct SemVer {
    major: u32,
    minor: u32,
    patch: u32,
    dev: u32,
    commit: String,
}

impl fmt::Display for SemVer {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if self.dev == 0 {
            write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
        } else {
            write!(f, "{}.{}.{}-dev.{}", self.major, self.minor, self.patch, self.dev)
        }
    }
}

fn resolve_git_semver() -> anyhow::Result<SemVer> {
    let raw_git_commit_hash = std::process::Command::new("git")
        .args(&["log", "-1", "--format=%h"])
        .output()?
        .stdout;
    let raw_git_last_tag = std::process::Command::new("git")
        .args(&["describe", "--tags", "--abbrev=0"])
        .output()?
        .stdout;
    let raw_git_iteration = std::process::Command::new("git")
        .args(&["describe", "--tags", "--long"])
        .output()?
        .stdout;
    let git_commit = std::str::from_utf8(&raw_git_commit_hash)?
        .trim()
        .to_string();
    let git_last_tag = std::str::from_utf8(&raw_git_last_tag)?
        .trim()
        .to_string();
    let git_iteration = std::str::from_utf8(&raw_git_iteration)?
        .trim()
        .to_string();

    let mut out = SemVer::default();

    let parsed_last_tag = match Regex::new("v([0-9]+).([0-9]+).([0-9]+)")?.captures(&git_last_tag) {
        Some(v) => v,
        None => anyhow::bail!("failed to parse git commit hash"),
    };
    out.major = parsed_last_tag.get(1).unwrap().as_str().parse()?;
    out.minor = parsed_last_tag.get(2).unwrap().as_str().parse()?;
    out.patch = parsed_last_tag.get(3).unwrap().as_str().parse()?;

    let parsed_iteration = match Regex::new(".*-([0-9]+)-.*")?.captures(&git_iteration) {
        Some(v) => v,
        None => anyhow::bail!("failed to parse git iteration"),
    };
    out.dev = parsed_iteration.get(1).unwrap().as_str().parse()?;

    out.commit = git_commit;
    Ok(out)
}

fn main() -> anyhow::Result<()> {
    // Version: from env file (Bazel), from env vars, or git describe.
    let semver = if let Ok(path) = std::env::var("DASHQL_VERSION_ENV_FILE") {
        let content = std::fs::read_to_string(&path)?;
        let mut major = 0u32;
        let mut minor = 0u32;
        let mut patch = 1u32;
        let mut dev = 0u32;
        let mut commit = String::from("unknown");
        let mut version_text = String::from("0.0.1");
        for line in content.lines() {
            let (k, v) = line.split_once('=').unwrap_or(("", ""));
            match k.trim() {
                "DASHQL_VERSION_MAJOR" => major = v.trim().parse().unwrap_or(0),
                "DASHQL_VERSION_MINOR" => minor = v.trim().parse().unwrap_or(0),
                "DASHQL_VERSION_PATCH" => patch = v.trim().parse().unwrap_or(0),
                "DASHQL_VERSION_DEV" => dev = v.trim().parse().unwrap_or(0),
                "DASHQL_VERSION_COMMIT" => commit = v.trim().to_string(),
                "DASHQL_VERSION_TEXT" => version_text = v.trim().to_string(),
                _ => {}
            }
        }
        SemVer {
            major,
            minor,
            patch,
            dev,
            commit,
        }
    } else if std::env::var("DASHQL_VERSION_MAJOR").is_ok() {
        SemVer {
            major: std::env::var("DASHQL_VERSION_MAJOR").unwrap().parse().unwrap_or(0),
            minor: std::env::var("DASHQL_VERSION_MINOR").unwrap().parse().unwrap_or(0),
            patch: std::env::var("DASHQL_VERSION_PATCH").unwrap().parse().unwrap_or(0),
            dev: std::env::var("DASHQL_VERSION_DEV").unwrap().parse().unwrap_or(0),
            commit: std::env::var("DASHQL_VERSION_COMMIT").unwrap_or_else(|_| "unknown".into()),
        }
    } else {
        resolve_git_semver()?
    };

    println!("cargo:rerun-if-env-changed=DASHQL_VERSION");
    println!("cargo:rustc-env=DASHQL_VERSION_MAJOR={}", semver.major);
    println!("cargo:rustc-env=DASHQL_VERSION_MINOR={}", semver.minor);
    println!("cargo:rustc-env=DASHQL_VERSION_PATCH={}", semver.patch);
    println!("cargo:rustc-env=DASHQL_VERSION_DEV={}", semver.dev);
    println!("cargo:rustc-env=DASHQL_VERSION_COMMIT={}", semver.commit);
    println!("cargo:rustc-env=DASHQL_VERSION_TEXT={}", semver);

    // Proto: use OUT_DIR so both Cargo and Bazel work. Under Bazel, PROTO_COMPUTE_PROTO is the path to compute.proto.
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by Cargo/Bazel");
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
