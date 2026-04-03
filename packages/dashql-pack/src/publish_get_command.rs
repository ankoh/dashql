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

#[derive(Parser, Debug)]
pub struct PublishGetArgs {
    #[arg(long, required = false, default_value = "false")]
    dry_run: bool,
    #[arg(long, required = false)]
    save_summary: Option<PathBuf>,
    #[arg(long, required = true)]
    source_dir: PathBuf,

    #[arg(long, required = true)]
    macos_dmg_path: PathBuf,
    #[arg(long, required = true)]
    macos_updater_bundle_path: PathBuf,
    #[arg(long, required = false)]
    macos_updater_signature_path: Option<PathBuf>,
}

pub async fn publish_get(args: PublishGetArgs) -> Result<()> {
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    let git_repo = collect_git_info(&args.source_dir)?;
    log::info!("git description: {}", &git_repo.version.description);

    let version = build_release_version(&git_repo.version)?;
    log::info!("release version: {}", &version.version);
    log::info!("release id: {}", &version.id);
    log::info!("release channel: {}", &version.channel);

    let url = "https://get.dashql.app".to_string();
    let rel = Release::build(ReleaseArgs {
        remote_base_url: url.clone(),
        git_repo: git_repo.clone(),
        release_version: version,
        macos_dmg_path: args.macos_dmg_path,
        macos_updater_bundle_path: args.macos_updater_bundle_path,
        macos_updater_signature_path: args.macos_updater_signature_path,
    })
    .await?;

    let remote_access = RemoteAccess::from_env("DASHQL_GET", "dashql-get")?;
    log::info!("r2 bucket: {} (from environment)", &remote_access.bucket);

    let r2_client = remote_access.build_client();

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

    if !args.dry_run {
        rel.publish(&r2_client, &remote_access.bucket).await?;
    }
    Ok(())
}
