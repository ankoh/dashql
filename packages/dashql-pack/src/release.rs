use aws_sdk_s3::primitives::ByteStream;
use chrono::prelude::*;
use futures::StreamExt;
use std::{collections::HashMap, io::Read};
use std::path::PathBuf;

use crate::{
    git_info::GitInfo,
    release_metadata::{
        Architecture, Bundle, BundleTarget, BundleType, Platform, ReleaseMetadata, UpdateArtifact,
        UpdateManifest,
    },
    release_version::ReleaseVersion,
    remote_paths::{derive_remote_paths, electron_channel_manifest},
};

#[derive(Debug)]
pub struct FileUpload {
    pub source_path: PathBuf,
    pub remote_path: String,
}

#[derive(Default, Debug)]
pub struct Release {
    pub file_uploads: HashMap<String, FileUpload>,
    pub release_metadata: ReleaseMetadata,
    pub release_metadata_path: String,
    pub release_update_manifest: UpdateManifest,
    pub release_update_manifest_path: String,
    pub channel_metadata_paths: Vec<&'static str>,
    pub channel_update_manifest_paths: Vec<&'static str>,
    pub electron_channel_manifests: Vec<(String, Vec<u8>)>,
}

pub struct ReleaseArgs {
    pub remote_base_url: String,
    pub git_repo: GitInfo,
    pub release_version: ReleaseVersion,
    pub macos_arm64_dmg_path: PathBuf,
    pub macos_arm64_zip_path: PathBuf,
    pub macos_arm64_zip_blockmap_path: PathBuf,
    pub macos_arm64_update_manifest_path: PathBuf,
    pub macos_x64_dmg_path: PathBuf,
    pub macos_x64_zip_path: PathBuf,
    pub macos_x64_zip_blockmap_path: PathBuf,
    pub macos_x64_update_manifest_path: PathBuf,
}

fn file_name(path: &PathBuf) -> anyhow::Result<String> {
    path.file_name().and_then(|value| value.to_str()).map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("artifact path has no valid file name: {:?}", path))
}

impl Release {
    pub async fn build(args: ReleaseArgs) -> anyhow::Result<Self> {
        let remote_paths = derive_remote_paths(&args.release_version);

        let mut release = Release::default();
        let pub_date = Utc::now();

        // Prepare release metadata
        release.release_metadata_path = remote_paths.release_metadata.clone();
        release.release_metadata.release_id = args.release_version.id.to_string();
        release.release_metadata.version = args.release_version.version.clone();
        release.release_metadata.pub_date = pub_date.clone();
        release.release_metadata.update_manifest_url = format!(
            "{}/{}",
            &args.remote_base_url,
            remote_paths.release_update.clone()
        );
        release.release_metadata.git_commit_hash = args.git_repo.version.short_hash.clone();
        release.release_metadata.git_commit_url = format!(
            "https://github.com/ankoh/dashql/tree/{}",
            &args.git_repo.version.short_hash
        );

        // Prepare update manifest
        release.release_update_manifest_path = remote_paths.release_update.clone();
        release.release_update_manifest.version = args.release_version.version.clone();
        release.release_update_manifest.pub_date = pub_date;
        release.release_update_manifest.notes = "".to_string(); // XXX Get from commit info

        // Prepare channel paths
        release.channel_metadata_paths = remote_paths.channel_metadata.clone();
        release.channel_update_manifest_paths = remote_paths.channel_update.clone();

        for (arch, architecture, dmg, zip, blockmap, manifest) in [
            ("arm64", Architecture::Aarch64, &args.macos_arm64_dmg_path, &args.macos_arm64_zip_path, &args.macos_arm64_zip_blockmap_path, &args.macos_arm64_update_manifest_path),
            ("x64", Architecture::X86_64, &args.macos_x64_dmg_path, &args.macos_x64_zip_path, &args.macos_x64_zip_blockmap_path, &args.macos_x64_update_manifest_path),
        ] {
            for artifact in [dmg, zip, blockmap] {
                if !artifact.is_file() {
                    return Err(anyhow::anyhow!("missing Electron artifact: {:?}", artifact));
                }
                let remote_path = format!("{}/macos/{}/{}", remote_paths.release_directory, arch, file_name(artifact)?);
                release.file_uploads.insert(remote_path.clone(), FileUpload {source_path: artifact.clone(), remote_path});
            }

            let dmg_name = file_name(dmg)?;
            let remote_path = format!("{}/macos/{}/{}", remote_paths.release_directory, arch, dmg_name);
            let remote_url = format!("{}/{}", &args.remote_base_url, remote_path);
            let bundle = Bundle {
                url: remote_url.clone(),
                signature: None,
                name: dmg_name,
                bundle_type: BundleType::Dmg,
                targets: vec![BundleTarget {platform: Platform::Darwin, arch: architecture}],
            };
            release.release_metadata.bundles.push(bundle);

            let zip_name = file_name(zip)?;
            let zip_remote_path = format!("{}/macos/{}/{}", remote_paths.release_directory, arch, zip_name);
            let update_artifact = UpdateArtifact {
                url: format!("{}/{}", &args.remote_base_url, zip_remote_path),
                signature: String::new(),
            };
            release.release_update_manifest.platforms.insert(BundleTarget {platform: Platform::Darwin, arch: architecture}, update_artifact);

            let manifest_text = std::fs::read_to_string(manifest)?;
            let artifact_base = format!("{}/{}/macos/{}/", args.remote_base_url, remote_paths.release_directory, arch);
            let manifest_text = manifest_text
                .replace(&format!("url: {}", zip_name), &format!("url: {}{}", artifact_base, zip_name))
                .replace(&format!("path: {}", zip_name), &format!("path: {}{}", artifact_base, zip_name));
            release.electron_channel_manifests.push((electron_channel_manifest(remote_paths.channel, arch), manifest_text.into_bytes()));
            if remote_paths.channel == "stable" {
                release.electron_channel_manifests.push((electron_channel_manifest("canary", arch), release.electron_channel_manifests.last().unwrap().1.clone()));
            }
        }

        log::info!("{:?}", &release);
        Ok(release)
    }

    pub async fn publish(&self, client: &aws_sdk_s3::Client) -> anyhow::Result<()> {
        // Upload files one by one first to work around R2 upload issue
        for (_, file_upload) in self.file_uploads.iter() {
            let path = file_upload.remote_path.clone();
            let client = client.clone();
            log::info!("upload started, path={}", &path);

            let result = multipart_upload(&client, &file_upload.source_path, &path).await;
            match result {
                Ok(_) => {
                    log::info!("multipart upload finished, path={}", &path);
                }
                Err(e) => {
                    log::error!("multipart upload failed, path={}, error={}", &path, &e);
                    return Err(e);
                }
            }
        }

        // Serialize release metadata and update manifest and abort after serialization errors
        let release_metadata = serde_json::to_string_pretty(&self.release_metadata)?
            .as_bytes()
            .to_vec();
        let update_manifest = serde_json::to_string_pretty(&self.release_update_manifest)?
            .as_bytes()
            .to_vec();

        // Collect json file uploads
        let mut pending_uploads = vec![
            (self.release_metadata_path.clone(), &release_metadata),
            (self.release_update_manifest_path.clone(), &update_manifest),
        ];

        // Spawn json uploads for release files
        let mut upload_futures = futures::stream::FuturesUnordered::new();
        for (path, metadata) in pending_uploads.drain(..) {
            let path = path.clone();
            let bytes = ByteStream::from(metadata.to_vec());
            let client = client.clone();
            let content_type = if path.ends_with(".yml") {"application/yaml"} else {"application/json"};
            log::info!("upload started, path={}", &path);
            upload_futures.push(tokio::spawn(async move {
                client
                    .put_object()
                    .bucket("dashql-get")
                    .key(&path)
                    .body(bytes)
                    .content_type(content_type)
                    // Versioned release files are immutable, cache them aggressively.
                    .cache_control("public, max-age=31536000, immutable")
                    .send()
                    .await
                    .map_err(|e| (path.clone(), e))
                    .map(|_| path.clone())
            }));
        }

        // Join all uploads
        let mut upload_error: Option<anyhow::Error> = None;
        let mut channel_upload_error: Option<anyhow::Error> = None;
        while let Some(next) = upload_futures.next().await {
            match next {
                Ok(Ok(path)) => {
                    log::info!("upload finished, path={}", &path);
                }
                Ok(Err((path, e))) => {
                    log::error!("upload failed, path={}, error={}", &path, &e);
                    upload_error = Some(e.into());
                }
                Err(e) => {
                    log::error!("failed to join upload task, error={}", &e);
                    upload_error = Some(anyhow::format_err!(
                        "failed to join upload task, error={}",
                        &e
                    ));
                }
            }
        }
        // Don't update the top-level release metadata if any of the release uploads failed
        if let Some(e) = upload_error {
            return Err(e);
        }

        // Update mutable channel pointers only after every immutable artifact is available.
        for channel_metadata_path in self.channel_metadata_paths.iter() {
            pending_uploads.push((channel_metadata_path.to_string(), &release_metadata));
        }
        for ref channel_update_manifest_path in self.channel_update_manifest_paths.iter() {
            pending_uploads.push((channel_update_manifest_path.to_string(), &update_manifest));
        }
        for (path, manifest) in &self.electron_channel_manifests {
            pending_uploads.push((path.clone(), manifest));
        }
        for (path, metadata) in pending_uploads.drain(..) {
            let path = path.clone();
            let bytes = ByteStream::from(metadata.to_vec());
            let client = client.clone();
            log::info!("upload started, path={}", &path);
            upload_futures.push(tokio::spawn(async move {
                client
                    .put_object()
                    .bucket("dashql-get")
                    .key(&path)
                    .body(bytes)
                    .content_type("application/json")
                    // Channel pointers (stable.json/canary.json + update manifests) are mutable.
                    // Force revalidation on every load so clients never serve a stale channel
                    // manifest from heuristic browser caching (revalidates cheaply via ETag).
                    .cache_control("no-cache")
                    .send()
                    .await
                    .map_err(|e| (path.clone(), e))
                    .map(|_| path.clone())
            }));
        }

        // Join all uploads
        while let Some(next) = upload_futures.next().await {
            match next {
                Ok(Ok(path)) => {
                    log::info!("upload finished, path={}", &path);
                }
                Ok(Err((path, e))) => {
                    log::error!("upload failed, path={}, error={}", &path, &e);
                    channel_upload_error = Some(e.into());
                }
                Err(e) => {
                    log::error!("failed to join upload task, error={}", &e);
                    channel_upload_error = Some(e.into());
                }
            }
        }
        if let Some(error) = channel_upload_error {
            return Err(error);
        }
        Ok(())
    }
}

async fn multipart_upload(
    client: &aws_sdk_s3::Client,
    source_path: &PathBuf,
    remote_path: &str,
) -> anyhow::Result<()> {
    // Create multipart upload
    let create_upload = client
        .create_multipart_upload()
        .bucket("dashql-get")
        .key(remote_path)
        .content_type("application/octet-stream")
        .cache_control("public, max-age=31536000, immutable")
        .send()
        .await?;
    let upload_id = create_upload.upload_id().unwrap();

    // Read file in chunks
    let file = std::fs::File::open(source_path)?;
    let mut reader = std::io::BufReader::new(file);
    let mut part_number = 1;
    let mut parts = Vec::new();
    let mut buffer = vec![0; 5 * 1024 * 1024]; // 5MB chunks

    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }

        let part = client
            .upload_part()
            .bucket("dashql-get")
            .key(remote_path)
            .upload_id(upload_id)
            .part_number(part_number)
            .body(ByteStream::from(buffer[..bytes_read].to_vec()))
            .send()
            .await?;

        parts.push(aws_sdk_s3::types::CompletedPart::builder()
            .part_number(part_number)
            .e_tag(part.e_tag().unwrap())
            .build());

        part_number += 1;
    }

    // Complete multipart upload
    client
        .complete_multipart_upload()
        .bucket("dashql-get")
        .key(remote_path)
        .upload_id(upload_id)
        .multipart_upload(aws_sdk_s3::types::CompletedMultipartUpload::builder()
            .set_parts(Some(parts))
            .build())
        .send()
        .await?;

    Ok(())
}
