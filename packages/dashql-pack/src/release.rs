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
    remote_paths::derive_remote_paths,
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
}

pub struct ReleaseArgs {
    pub remote_base_url: String,
    pub git_repo: GitInfo,
    pub release_version: ReleaseVersion,
    pub macos_dmg_path: PathBuf,
    pub macos_updater_bundle_path: PathBuf,
    pub macos_updater_signature_path: Option<PathBuf>,
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

        // Register macOS .dmg
        if args.macos_dmg_path.is_file() {
            let remote_path = format!("{}/macos/DashQL.dmg", remote_paths.release_directory);
            let remote_url = format!("{}/{}", &args.remote_base_url, remote_path);
            let bundle = Bundle {
                url: remote_url.clone(),
                signature: None,
                name: "DashQL.dmg".to_string(),
                bundle_type: BundleType::Dmg,
                targets: vec![
                    BundleTarget {
                        platform: Platform::Darwin,
                        arch: Architecture::X86_64,
                    },
                    BundleTarget {
                        platform: Platform::Darwin,
                        arch: Architecture::Aarch64,
                    },
                ],
            };

            // Create upload task
            let upload_task = FileUpload {
                source_path: args.macos_dmg_path.clone(),
                remote_path: remote_path.clone(),
            };
            release
                .file_uploads
                .insert(remote_path.clone(), upload_task);

            // Register release artifact
            release.release_metadata.bundles.push(bundle);
        }

        // Register macOS tauri update
        if args.macos_updater_bundle_path.is_file() {
            let remote_path = format!("{}/macos/DashQL.app.tar.gz", remote_paths.release_directory);
            let remote_url = format!("{}/{}", &args.remote_base_url, &remote_path);
            let sig = if let Some(sig_path) = &args.macos_updater_signature_path {
                if sig_path.is_file() {
                    Some(std::fs::read_to_string(sig_path)?)
                } else {
                    None
                }
            } else {
                None
            };
            let update_artifact = UpdateArtifact {
                url: remote_url.clone(),
                signature: sig.unwrap_or_default(),
            };

            // Create upload task
            let upload_task = FileUpload {
                source_path: args.macos_updater_bundle_path.clone(),
                remote_path: remote_path.clone(),
            };
            release
                .file_uploads
                .insert(remote_path.clone(), upload_task);

            // Register artifacts
            release.release_update_manifest.platforms.insert(
                BundleTarget {
                    platform: Platform::Darwin,
                    arch: Architecture::X86_64,
                },
                update_artifact.clone(),
            );
            release.release_update_manifest.platforms.insert(
                BundleTarget {
                    platform: Platform::Darwin,
                    arch: Architecture::Aarch64,
                },
                update_artifact.clone(),
            );
        }

        log::info!("{:?}", &release);
        Ok(release)
    }

    pub async fn publish(&self, client: &aws_sdk_s3::Client, bucket: &str) -> anyhow::Result<()> {
        // Upload files one by one first to work around R2 upload issue
        for (_, file_upload) in self.file_uploads.iter() {
            let path = file_upload.remote_path.clone();
            let client = client.clone();
            log::info!("upload started, path={}", &path);

            let result = multipart_upload(&client, bucket, &file_upload.source_path, &path).await;
            match result {
                Ok(_) => {
                    log::info!("multipart upload finished, path={}", &path);
                }
                Err(e) => {
                    log::error!("multipart upload failed, path={}, error={}", &path, &e);
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
            let bucket = bucket.to_string();
            log::info!("upload started, path={}", &path);
            upload_futures.push(tokio::spawn(async move {
                client
                    .put_object()
                    .bucket(&bucket)
                    .key(&path)
                    .body(bytes)
                    .content_type("application/json")
                    .send()
                    .await
                    .map_err(|e| (path.clone(), e))
                    .map(|_| path.clone())
            }));
        }

        // Join all uploads
        let mut upload_error: Option<anyhow::Error> = None;
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

        // Now update the release manifests
        for channel_metadata_path in self.channel_metadata_paths.iter() {
            pending_uploads.push((channel_metadata_path.to_string(), &release_metadata));
        }
        for ref channel_update_manifest_path in self.channel_update_manifest_paths.iter() {
            pending_uploads.push((channel_update_manifest_path.to_string(), &update_manifest));
        }
        for (path, metadata) in pending_uploads.drain(..) {
            let path = path.clone();
            let bytes = ByteStream::from(metadata.to_vec());
            let client = client.clone();
            let bucket = bucket.to_string();
            log::info!("upload started, path={}", &path);
            upload_futures.push(tokio::spawn(async move {
                client
                    .put_object()
                    .bucket(&bucket)
                    .key(&path)
                    .body(bytes)
                    .content_type("application/json")
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
                }
                Err(e) => {
                    log::error!("failed to join upload task, error={}", &e);
                }
            }
        }
        Ok(())
    }
}

async fn multipart_upload(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    source_path: &PathBuf,
    remote_path: &str,
) -> anyhow::Result<()> {
    let create_upload = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(remote_path)
        .content_type("application/octet-stream")
        .send()
        .await?;
    let upload_id = create_upload.upload_id().unwrap();

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
            .bucket(bucket)
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

    client
        .complete_multipart_upload()
        .bucket(bucket)
        .key(remote_path)
        .upload_id(upload_id)
        .multipart_upload(aws_sdk_s3::types::CompletedMultipartUpload::builder()
            .set_parts(Some(parts))
            .build())
        .send()
        .await?;

    Ok(())
}
