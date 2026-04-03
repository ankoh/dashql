use crate::{
    git_info::collect_git_info,
    remote_access::RemoteAccess,
    serde_date,
    serde_version,
};

use anyhow::Result;
use aws_sdk_s3::primitives::ByteStream;
use chrono::prelude::*;
use clap::Parser;
use futures::StreamExt;
use semver::Version;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
pub struct PublishAppArgs {
    #[arg(long, default_value = "false")]
    pub dry_run: bool,
    #[arg(long, required = true)]
    pub source_dir: PathBuf,
    #[arg(long, required = true)]
    pub app_dir: PathBuf,
    #[arg(long, required = true)]
    pub branch: String,
}

#[derive(Serialize)]
struct AppManifest {
    branch: String,
    #[serde(with = "serde_version")]
    version: Version,
    git_commit: String,
    #[serde(with = "serde_date")]
    pub_date: DateTime<Utc>,
    files: Vec<String>,
}

struct FileEntry {
    local_path: PathBuf,
    r2_key: String,
    content_type: &'static str,
    cache_control: &'static str,
}

fn content_type_for_extension(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "application/javascript",
        Some("css") => "text/css",
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("ttf") => "font/ttf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

fn is_html_file(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()), Some("html"))
}

fn walk_directory(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(walk_directory(&path)?);
        } else {
            files.push(path);
        }
    }
    Ok(files)
}

pub async fn publish_app(args: PublishAppArgs) -> Result<()> {
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    let git_repo = collect_git_info(&args.source_dir)?;
    log::info!("git description: {}", &git_repo.version.description);
    let semver = git_repo.version.as_semver();
    log::info!("version: {}", &semver);
    log::info!("branch: {}", &args.branch);

    let remote_access = RemoteAccess::from_env("DASHQL_APP", "dashql-app")?;
    log::info!("r2 bucket: {} (from environment)", &remote_access.bucket);
    let r2_client = remote_access.build_client();

    let prefix = format!("branches/{}", &args.branch);
    let local_files = walk_directory(&args.app_dir)?;
    log::info!("found {} files in {:?}", local_files.len(), &args.app_dir);

    let mut static_files: Vec<FileEntry> = Vec::new();
    let mut html_files: Vec<FileEntry> = Vec::new();

    for local_path in &local_files {
        let relative = local_path.strip_prefix(&args.app_dir)?;
        let r2_key = format!("{}/{}", &prefix, relative.to_string_lossy());
        let content_type = content_type_for_extension(local_path);
        let cache_control = if relative.starts_with("static") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };

        let entry = FileEntry {
            local_path: local_path.clone(),
            r2_key,
            content_type,
            cache_control,
        };

        if is_html_file(local_path) {
            html_files.push(entry);
        } else {
            static_files.push(entry);
        }
    }

    log::info!(
        "uploading {} static files, {} html files",
        static_files.len(),
        html_files.len()
    );

    if !args.dry_run {
        // Phase A: upload static files concurrently
        upload_files(&r2_client, &remote_access.bucket, &static_files).await?;
        // Phase B: upload HTML files last
        upload_files(&r2_client, &remote_access.bucket, &html_files).await?;
    }

    // Build and upload manifest
    let all_r2_keys: Vec<String> = static_files
        .iter()
        .chain(html_files.iter())
        .map(|f| f.r2_key.clone())
        .collect();

    let manifest = AppManifest {
        branch: args.branch.clone(),
        version: semver.clone(),
        git_commit: git_repo.version.short_hash.clone(),
        pub_date: Utc::now(),
        files: all_r2_keys,
    };

    let manifest_key = format!("manifests/manifest.{}.{}.json", &args.branch, &semver);
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    log::info!("manifest: {}", &manifest_key);

    if !args.dry_run {
        r2_client
            .put_object()
            .bucket(&remote_access.bucket)
            .key(&manifest_key)
            .body(ByteStream::from(manifest_json.into_bytes()))
            .content_type("application/json")
            .cache_control("no-cache")
            .send()
            .await?;
        log::info!("manifest uploaded: {}", &manifest_key);
    }

    log::info!("publish-app complete");
    Ok(())
}

async fn upload_files(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    files: &[FileEntry],
) -> Result<()> {
    let mut upload_futures = futures::stream::FuturesUnordered::new();

    for file in files {
        let data = std::fs::read(&file.local_path)?;
        let client = client.clone();
        let bucket = bucket.to_string();
        let key = file.r2_key.clone();
        let content_type = file.content_type.to_string();
        let cache_control = file.cache_control.to_string();

        log::info!("upload started: {}", &key);
        upload_futures.push(tokio::spawn(async move {
            client
                .put_object()
                .bucket(&bucket)
                .key(&key)
                .body(ByteStream::from(data))
                .content_type(&content_type)
                .cache_control(&cache_control)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("upload failed: {}, error: {}", &key, e))
                .map(|_| key.clone())
        }));
    }

    let mut had_error = false;
    while let Some(result) = upload_futures.next().await {
        match result {
            Ok(Ok(key)) => {
                log::info!("upload finished: {}", &key);
            }
            Ok(Err(e)) => {
                log::error!("{}", e);
                had_error = true;
            }
            Err(e) => {
                log::error!("failed to join upload task: {}", e);
                had_error = true;
            }
        }
    }

    if had_error {
        return Err(anyhow::anyhow!("one or more uploads failed"));
    }
    Ok(())
}
