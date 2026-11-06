use crate::{
    git_info::collect_git_info,
    release::{Release, ReleaseArgs},
    release_metadata::ReleaseSummary,
    release_version::build_release_version,
    remote_access::RemoteAccess,
};

use anyhow::Result;
use clap::Parser;
use std::io::Write;
use std::path::PathBuf;

/// Publish the macOS Electron artifacts of a release to R2
#[derive(Parser, Debug)]
pub struct PublishArgs {
    /// Build the release without uploading anything to R2
    #[arg(long, required = false, default_value = "false")]
    dry_run: bool,
    /// Write a JSON summary of the release to this path
    #[arg(long, required = false)]
    save_summary: Option<PathBuf>,
    /// The git repository to derive the release version from
    #[arg(long, required = true)]
    source_dir: PathBuf,

    /// The arm64 macOS DMG
    #[arg(long, required = true)]
    macos_arm64_dmg_path: PathBuf,
    /// The arm64 macOS ZIP used for auto updates
    #[arg(long, required = true)]
    macos_arm64_zip_path: PathBuf,
    /// The blockmap of the arm64 macOS ZIP
    #[arg(long, required = true)]
    macos_arm64_zip_blockmap_path: PathBuf,
    /// The electron-builder update manifest (latest-mac.yml) for arm64
    #[arg(long, required = true)]
    macos_arm64_update_manifest_path: PathBuf,
    /// The x64 macOS DMG
    #[arg(long, required = true)]
    macos_x64_dmg_path: PathBuf,
    /// The x64 macOS ZIP used for auto updates
    #[arg(long, required = true)]
    macos_x64_zip_path: PathBuf,
    /// The blockmap of the x64 macOS ZIP
    #[arg(long, required = true)]
    macos_x64_zip_blockmap_path: PathBuf,
    /// The electron-builder update manifest (latest-mac.yml) for x64
    #[arg(long, required = true)]
    macos_x64_update_manifest_path: PathBuf,
}

pub async fn publish(args: PublishArgs) -> Result<()> {
    // Is a dry-run?
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    // Resolve the git version
    let git_repo = collect_git_info(&args.source_dir)?;
    log::info!("git description: {}", &git_repo.version.description);

    let version = build_release_version(&git_repo.version)?;
    log::info!("release version: {}", &version.version);
    log::info!("release id: {}", &version.id);
    log::info!("release channel: {}", &version.channel);

    // Build the release
    let url = "https://get.dashql.app".to_string();
    let rel = Release::build(ReleaseArgs {
        remote_base_url: url.clone(),
        git_repo: git_repo.clone(),
        release_version: version,
        macos_arm64_dmg_path: args.macos_arm64_dmg_path,
        macos_arm64_zip_path: args.macos_arm64_zip_path,
        macos_arm64_zip_blockmap_path: args.macos_arm64_zip_blockmap_path,
        macos_arm64_update_manifest_path: args.macos_arm64_update_manifest_path,
        macos_x64_dmg_path: args.macos_x64_dmg_path,
        macos_x64_zip_path: args.macos_x64_zip_path,
        macos_x64_zip_blockmap_path: args.macos_x64_zip_blockmap_path,
        macos_x64_update_manifest_path: args.macos_x64_update_manifest_path,
    })
    .await?;

    // Check R2 credentials
    let remote_access = RemoteAccess::from_env()?;
    log::info!("r2 bucket: **** (from environment)");
    log::info!("r2 access key id: **** (from environment)");
    log::info!("r2 secret access key: **** (from environment)");

    let r2_client = remote_access.r2_client();

    // Write the metadata (if requested)
    if let Some(path) = &args.save_summary {
        let summary = ReleaseSummary {
            release_id: rel.release_metadata.release_id.clone(),
            pub_date: rel.release_metadata.pub_date.clone(),
            version: rel.release_metadata.version.clone(),
            git_commit_hash: git_repo.version.short_hash.clone(),
            git_commit_url: format!(
                "https://github.com/ankoh/dashql/tree/{}",
                &git_repo.version.short_hash
            ),
            bundle_macos_dmg_url: rel.release_metadata.bundles[0].url.clone(),
            release_metadata_url: format!("{}/{}", &url, &rel.release_metadata_path),
            update_manifest_url: rel.release_metadata.update_manifest_url.clone(),
        };
        let file = std::fs::File::create(path)?;
        let mut writer = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, &summary)?;
        writer.flush()?;
        log::info!("wrote release metadata to: {:?}", &path.as_path());
    }

    // Publish the release
    if !args.dry_run {
        rel.publish(&r2_client).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_s3::{git_repository, FakeS3, TempDir, ENV_LOCK};

    /// The arguments of the publish workflow for a repository and its artifacts
    fn args(source: &TempDir, artifacts: &TempDir, extra: &[String]) -> PublishArgs {
        let manifest = b"version: 1.2.3\npath: DashQL.zip\n";
        let mut argv: Vec<String> = vec!["publish".into(), "--source-dir".into(), source.path().display().to_string()];
        for (flag, name, content) in [
            ("--macos-arm64-dmg-path", "arm64.dmg", &b"dmg"[..]),
            ("--macos-arm64-zip-path", "arm64.zip", &b"zip"[..]),
            ("--macos-arm64-zip-blockmap-path", "arm64.zip.blockmap", &b"map"[..]),
            ("--macos-arm64-update-manifest-path", "arm64.yml", &manifest[..]),
            ("--macos-x64-dmg-path", "x64.dmg", &b"dmg"[..]),
            ("--macos-x64-zip-path", "x64.zip", &b"zip"[..]),
            ("--macos-x64-zip-blockmap-path", "x64.zip.blockmap", &b"map"[..]),
            ("--macos-x64-update-manifest-path", "x64.yml", &manifest[..]),
        ] {
            argv.push(flag.into());
            argv.push(artifacts.write(name, content).display().to_string());
        }
        argv.extend_from_slice(extra);
        PublishArgs::try_parse_from(argv).unwrap()
    }

    fn point_to(s3: &FakeS3) {
        std::env::set_var("DASHQL_GET_R2_ENDPOINT", s3.endpoint());
        std::env::set_var("DASHQL_GET_R2_ACCESS_KEY_ID", "key");
        std::env::set_var("DASHQL_GET_R2_SECRET_ACCESS_KEY", "secret");
    }

    #[tokio::test]
    async fn publishes_a_tagged_commit_to_the_stable_channel() {
        let _guard = ENV_LOCK.lock().await;
        let (source, artifacts) = (TempDir::new(), TempDir::new());
        git_repository(source.path(), "v1.2.3", 0);
        let s3 = FakeS3::start().await;
        point_to(&s3);
        publish(args(&source, &artifacts, &[])).await.unwrap();
        let pointer: serde_json::Value = serde_json::from_slice(&s3.object("stable.json").unwrap()).unwrap();
        assert_eq!(pointer["version"], "1.2.3");
    }

    #[tokio::test]
    async fn publishes_a_later_commit_to_the_latest_channel_only() {
        let _guard = ENV_LOCK.lock().await;
        let (source, artifacts) = (TempDir::new(), TempDir::new());
        git_repository(source.path(), "v1.2.3", 2);
        let s3 = FakeS3::start().await;
        point_to(&s3);
        publish(args(&source, &artifacts, &[])).await.unwrap();
        let pointer: serde_json::Value = serde_json::from_slice(&s3.object("latest.json").unwrap()).unwrap();
        assert_eq!(pointer["version"], "1.2.4-dev.2");
        assert_eq!(s3.object("stable.json"), None);
    }

    #[tokio::test]
    async fn a_dry_run_writes_the_summary_and_uploads_nothing() {
        let _guard = ENV_LOCK.lock().await;
        let (source, artifacts) = (TempDir::new(), TempDir::new());
        git_repository(source.path(), "v1.2.3", 0);
        let s3 = FakeS3::start().await;
        point_to(&s3);
        let summary = artifacts.path().join("summary.json");
        let extra = ["--dry-run".to_string(), "--save-summary".to_string(), summary.display().to_string()];
        publish(args(&source, &artifacts, &extra)).await.unwrap();
        assert!(s3.requests().is_empty());

        let summary: serde_json::Value = serde_json::from_slice(&std::fs::read(summary).unwrap()).unwrap();
        assert_eq!(summary["version"], "1.2.3");
        assert_eq!(summary["release_metadata_url"], "https://get.dashql.app/releases/1.2.3/metadata.json");
        assert_eq!(summary["update_manifest_url"], "https://get.dashql.app/releases/1.2.3/update.json");
        assert_eq!(summary["bundle_macos_dmg_url"], "https://get.dashql.app/releases/1.2.3/macos/arm64/arm64.dmg");
    }

    #[tokio::test]
    async fn stops_before_uploading_without_a_version() {
        let _guard = ENV_LOCK.lock().await;
        let (source, artifacts) = (TempDir::new(), TempDir::new());
        let s3 = FakeS3::start().await;
        point_to(&s3);
        assert!(publish(args(&source, &artifacts, &[])).await.is_err());
        assert!(s3.requests().is_empty());
    }

    #[tokio::test]
    async fn needs_credentials() {
        let _guard = ENV_LOCK.lock().await;
        let (source, artifacts) = (TempDir::new(), TempDir::new());
        git_repository(source.path(), "v1.2.3", 0);
        std::env::remove_var("DASHQL_GET_R2_SECRET_ACCESS_KEY");
        std::env::set_var("DASHQL_GET_R2_ENDPOINT", "http://127.0.0.1:1");
        std::env::set_var("DASHQL_GET_R2_ACCESS_KEY_ID", "key");
        let error = publish(args(&source, &artifacts, &[])).await.unwrap_err();
        assert!(error.to_string().contains("DASHQL_GET_R2_SECRET_ACCESS_KEY"), "{error}");
    }
}
