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

const CANARY_BADGE_PATH: &str = "channels/canary/badge.svg";

/// A local file to upload into the release bucket
#[derive(Debug)]
pub struct FileUpload {
    /// The local path of the file
    pub source_path: PathBuf,
    /// The object key in the release bucket
    pub remote_path: String,
}

/// A release prepared for upload, with its artifacts, metadata and channel pointers
#[derive(Default, Debug)]
pub struct Release {
    /// The artifact uploads, keyed by remote path
    pub file_uploads: HashMap<String, FileUpload>,
    /// The metadata of the release
    pub release_metadata: ReleaseMetadata,
    /// The object key of the release metadata
    pub release_metadata_path: String,
    /// The update manifest of the release
    pub release_update_manifest: UpdateManifest,
    /// The object key of the release update manifest
    pub release_update_manifest_path: String,
    /// The channel metadata keys that are pointed to this release
    pub channel_metadata_paths: Vec<&'static str>,
    /// The channel update manifest keys that are pointed to this release
    pub channel_update_manifest_paths: Vec<&'static str>,
    /// The electron-builder channel manifests as `(object key, content)` pairs
    pub electron_channel_manifests: Vec<(String, Vec<u8>)>,
    /// The SVG version badge uploaded for the canary channel
    pub canary_badge: Vec<u8>,
}

/// The inputs for building a [`Release`]
pub struct ReleaseArgs {
    /// The public base URL of the release bucket, e.g. `https://get.dashql.app`
    pub remote_base_url: String,
    /// The git information of the released commit
    pub git_repo: GitInfo,
    /// The version, id and channel of the release
    pub release_version: ReleaseVersion,
    /// The path of the arm64 macOS DMG
    pub macos_arm64_dmg_path: PathBuf,
    /// The path of the arm64 macOS ZIP used for auto updates
    pub macos_arm64_zip_path: PathBuf,
    /// The path of the blockmap of the arm64 macOS ZIP
    pub macos_arm64_zip_blockmap_path: PathBuf,
    /// The path of the electron-builder update manifest for arm64
    pub macos_arm64_update_manifest_path: PathBuf,
    /// The path of the x64 macOS DMG
    pub macos_x64_dmg_path: PathBuf,
    /// The path of the x64 macOS ZIP used for auto updates
    pub macos_x64_zip_path: PathBuf,
    /// The path of the blockmap of the x64 macOS ZIP
    pub macos_x64_zip_blockmap_path: PathBuf,
    /// The path of the electron-builder update manifest for x64
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
        release.canary_badge = build_version_badge(&args.release_version.version.to_string()).into_bytes();

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
        pending_uploads.push((CANARY_BADGE_PATH.to_string(), &self.canary_badge));
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
                    .content_type(content_type(&path))
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

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".yml") {
        "application/yaml"
    } else {
        "application/json"
    }
}

fn build_version_badge(version: &str) -> String {
    const LABEL: &str = "version";
    const LABEL_WIDTH: usize = 51;
    const CHARACTER_WIDTH: usize = 7;
    const VALUE_PADDING: usize = 10;

    let escaped_version = version
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    let value_width = version.chars().count() * CHARACTER_WIDTH + VALUE_PADDING;
    let width = LABEL_WIDTH + value_width;
    let label_center = LABEL_WIDTH * 5;
    let value_center = (LABEL_WIDTH + value_width / 2) * 10;
    let label_text_length = 410;
    let value_text_length = (value_width - VALUE_PADDING) * 10;
    let title = format!("{LABEL}: {escaped_version}");

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" role="img" aria-label="{title}"><title>{title}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="{width}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="{LABEL_WIDTH}" height="20" fill="#555"/><rect x="{LABEL_WIDTH}" width="{value_width}" height="20" fill="#007ec6"/><rect width="{width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text aria-hidden="true" x="{label_center}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{label_text_length}">{LABEL}</text><text x="{label_center}" y="140" transform="scale(.1)" fill="#fff" textLength="{label_text_length}">{LABEL}</text><text aria-hidden="true" x="{value_center}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{value_text_length}">{escaped_version}</text><text x="{value_center}" y="140" transform="scale(.1)" fill="#fff" textLength="{value_text_length}">{escaped_version}</text></g></svg>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_info::GitVersion;
    use crate::release_version::build_release_version;
    use crate::test_s3::{FakeS3, TempDir};
    use semver::Version;

    #[test]
    fn builds_version_badge() {
        let badge = build_version_badge("0.0.7-dev.6");

        assert!(badge.contains("width=\"138\""));
        assert!(badge.contains("aria-label=\"version: 0.0.7-dev.6\""));
        assert!(badge.contains(">version</text>"));
        assert_eq!(badge.matches(">0.0.7-dev.6</text>").count(), 2);
    }

    #[test]
    fn escapes_version_badge_text() {
        let badge = build_version_badge("1<&\"'>");

        assert!(badge.contains("version: 1&lt;&amp;&quot;&apos;&gt;"));
        assert!(!badge.contains("version: 1<&\"'>"));
    }

    #[test]
    fn detects_upload_content_type() {
        assert_eq!(content_type("channels/canary/badge.svg"), "image/svg+xml");
        assert_eq!(content_type("latest-mac.yml"), "application/yaml");
        assert_eq!(content_type("canary.json"), "application/json");
    }

    const IMMUTABLE: &str = "public, max-age=31536000, immutable";
    const ARM64_DMG: &str = "DashQL-arm64.dmg";
    const ARM64_ZIP: &str = "DashQL-arm64.zip";

    /// The artifacts of a release in a directory
    fn release_args(dir: &TempDir, iteration: u32) -> ReleaseArgs {
        let manifest = |zip: &str| format!("version: 1.2.3\nfiles:\n  - url: {zip}\n    sha512: abc\npath: {zip}\nsha512: abc\n");
        let git_version = GitVersion {
            description: format!("v1.2.3-{iteration}-gabc1234"),
            major: 1,
            minor: 2,
            patch: 3,
            iteration,
            short_hash: "abc1234".to_string(),
        };
        ReleaseArgs {
            remote_base_url: "https://get.example".to_string(),
            release_version: build_release_version(&git_version).unwrap(),
            git_repo: GitInfo { version: git_version },
            macos_arm64_dmg_path: dir.write(ARM64_DMG, b"arm64 dmg"),
            macos_arm64_zip_path: dir.write(ARM64_ZIP, b"arm64 zip"),
            macos_arm64_zip_blockmap_path: dir.write("DashQL-arm64.zip.blockmap", b"arm64 blockmap"),
            macos_arm64_update_manifest_path: dir.write("arm64.yml", manifest(ARM64_ZIP).as_bytes()),
            macos_x64_dmg_path: dir.write("DashQL-x64.dmg", b"x64 dmg"),
            macos_x64_zip_path: dir.write("DashQL-x64.zip", b"x64 zip"),
            macos_x64_zip_blockmap_path: dir.write("DashQL-x64.zip.blockmap", b"x64 blockmap"),
            macos_x64_update_manifest_path: dir.write("x64.yml", manifest("DashQL-x64.zip").as_bytes()),
        }
    }

    /// The mutable pointers that clients read to find a release
    fn is_channel_pointer(key: &str) -> bool {
        !key.starts_with("releases/")
    }

    #[tokio::test]
    async fn builds_the_paths_of_a_stable_release() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();

        assert_eq!(release.release_metadata.version, Version::new(1, 2, 3));
        assert_eq!(release.release_metadata_path, "releases/1.2.3/metadata.json");
        assert_eq!(release.release_metadata.update_manifest_url, "https://get.example/releases/1.2.3/update.json");
        assert_eq!(release.release_metadata.git_commit_url, "https://github.com/ankoh/dashql/tree/abc1234");
        assert_eq!(release.channel_metadata_paths, vec!["stable.json", "canary.json"]);
        assert_eq!(release.channel_update_manifest_paths, vec!["stable-update.json", "canary-update.json"]);

        let mut uploads: Vec<&String> = release.file_uploads.keys().collect();
        uploads.sort();
        assert_eq!(uploads, vec![
            "releases/1.2.3/macos/arm64/DashQL-arm64.dmg",
            "releases/1.2.3/macos/arm64/DashQL-arm64.zip",
            "releases/1.2.3/macos/arm64/DashQL-arm64.zip.blockmap",
            "releases/1.2.3/macos/x64/DashQL-x64.dmg",
            "releases/1.2.3/macos/x64/DashQL-x64.zip",
            "releases/1.2.3/macos/x64/DashQL-x64.zip.blockmap",
        ]);
        assert_eq!(release.release_metadata.bundles[0].url, "https://get.example/releases/1.2.3/macos/arm64/DashQL-arm64.dmg");
        assert_eq!(release.release_metadata.bundles.len(), 2);
        assert_eq!(release.release_update_manifest.platforms[&BundleTarget {platform: Platform::Darwin, arch: Architecture::Aarch64}].url,
            "https://get.example/releases/1.2.3/macos/arm64/DashQL-arm64.zip");
        assert_eq!(release.release_update_manifest.platforms[&BundleTarget {platform: Platform::Darwin, arch: Architecture::X86_64}].url,
            "https://get.example/releases/1.2.3/macos/x64/DashQL-x64.zip");
    }

    #[tokio::test]
    async fn a_stable_release_also_moves_the_canary_feeds() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let feeds: Vec<&str> = release.electron_channel_manifests.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(feeds, vec![
            "channels/stable/macos/arm64/latest-mac.yml",
            "channels/canary/macos/arm64/latest-mac.yml",
            "channels/stable/macos/x64/latest-mac.yml",
            "channels/canary/macos/x64/latest-mac.yml",
        ]);
    }

    #[tokio::test]
    async fn a_canary_release_leaves_the_stable_channel_alone() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 4)).await.unwrap();
        assert_eq!(release.release_metadata.version.to_string(), "1.2.4-dev.4");
        assert_eq!(release.channel_metadata_paths, vec!["canary.json"]);
        assert_eq!(release.channel_update_manifest_paths, vec!["canary-update.json"]);
        assert!(release.electron_channel_manifests.iter().all(|(path, _)| path.starts_with("channels/canary/")));
    }

    #[tokio::test]
    async fn the_electron_feed_points_to_the_versioned_artifacts() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let (_, manifest) = &release.electron_channel_manifests[0];
        let manifest = String::from_utf8(manifest.clone()).unwrap();
        let artifact = "https://get.example/releases/1.2.3/macos/arm64/DashQL-arm64.zip";
        assert!(manifest.contains(&format!("  - url: {artifact}\n")), "{manifest}");
        assert!(manifest.contains(&format!("\npath: {artifact}\n")), "{manifest}");
        // The checksums of the file stay valid
        assert_eq!(manifest.matches("sha512: abc").count(), 2);
    }

    #[tokio::test]
    async fn refuses_a_release_with_a_missing_artifact() {
        let dir = TempDir::new();
        let mut args = release_args(&dir, 0);
        args.macos_x64_zip_blockmap_path = dir.path().join("missing.blockmap");
        let error = Release::build(args).await.unwrap_err();
        assert!(error.to_string().contains("missing Electron artifact"), "{error}");
    }

    #[tokio::test]
    async fn refuses_a_release_with_a_missing_update_manifest() {
        let dir = TempDir::new();
        let mut args = release_args(&dir, 0);
        args.macos_arm64_update_manifest_path = dir.path().join("missing.yml");
        assert!(Release::build(args).await.is_err());
    }

    #[tokio::test]
    async fn publishes_every_file_of_a_release() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        release.publish(&s3.client()).await.unwrap();

        assert_eq!(s3.object_keys(), vec![
            "canary-update.json",
            "canary.json",
            "channels/canary/badge.svg",
            "channels/canary/macos/arm64/latest-mac.yml",
            "channels/canary/macos/x64/latest-mac.yml",
            "channels/stable/macos/arm64/latest-mac.yml",
            "channels/stable/macos/x64/latest-mac.yml",
            "releases/1.2.3/macos/arm64/DashQL-arm64.dmg",
            "releases/1.2.3/macos/arm64/DashQL-arm64.zip",
            "releases/1.2.3/macos/arm64/DashQL-arm64.zip.blockmap",
            "releases/1.2.3/macos/x64/DashQL-x64.dmg",
            "releases/1.2.3/macos/x64/DashQL-x64.zip",
            "releases/1.2.3/macos/x64/DashQL-x64.zip.blockmap",
            "releases/1.2.3/metadata.json",
            "releases/1.2.3/update.json",
            "stable-update.json",
            "stable.json",
        ]);
        assert_eq!(s3.object("releases/1.2.3/macos/arm64/DashQL-arm64.dmg").unwrap(), b"arm64 dmg");
        let pointer: serde_json::Value = serde_json::from_slice(&s3.object("stable.json").unwrap()).unwrap();
        assert_eq!(pointer["version"], "1.2.3");
        assert_eq!(s3.object("stable.json"), s3.object("releases/1.2.3/metadata.json"));
        assert_eq!(s3.object("canary-update.json"), s3.object("releases/1.2.3/update.json"));
    }

    #[tokio::test]
    async fn moves_the_channel_pointers_only_after_every_immutable_file() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        release.publish(&s3.client()).await.unwrap();

        let requests = s3.requests();
        let first_pointer = requests.iter().position(|request| is_channel_pointer(&request.key)).unwrap();
        assert!(requests[first_pointer..].iter().all(|request| is_channel_pointer(&request.key)));
        assert_eq!(requests[first_pointer..].len(), 9);
    }

    #[tokio::test]
    async fn caches_versioned_files_forever_and_revalidates_pointers() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        release.publish(&s3.client()).await.unwrap();

        let header = |key: &str, name: &str| s3.requests().iter()
            .find(|request| request.key == key && (request.method == "PUT" || request.query.contains_key("uploads")))
            .and_then(|request| request.headers.get(name).cloned());
        for key in ["releases/1.2.3/metadata.json", "releases/1.2.3/macos/arm64/DashQL-arm64.dmg"] {
            assert_eq!(header(key, "cache-control").as_deref(), Some(IMMUTABLE), "{key}");
        }
        for key in ["stable.json", "canary-update.json", "channels/canary/badge.svg", "channels/stable/macos/x64/latest-mac.yml"] {
            assert_eq!(header(key, "cache-control").as_deref(), Some("no-cache"), "{key}");
        }
        assert_eq!(header("channels/canary/badge.svg", "content-type").as_deref(), Some("image/svg+xml"));
        assert_eq!(header("channels/stable/macos/x64/latest-mac.yml", "content-type").as_deref(), Some("application/yaml"));
        assert_eq!(header("stable.json", "content-type").as_deref(), Some("application/json"));
    }

    #[tokio::test]
    async fn a_failed_artifact_upload_leaves_the_channels_alone() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        s3.deny_upload("releases/1.2.3/macos/x64/DashQL-x64.zip");
        assert!(release.publish(&s3.client()).await.is_err());
        assert!(s3.object_keys().iter().all(|key| !is_channel_pointer(key)), "{:?}", s3.object_keys());
        assert_eq!(s3.object("releases/1.2.3/metadata.json"), None);
    }

    #[tokio::test]
    async fn a_failed_metadata_upload_leaves_the_channels_alone() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        s3.deny_upload("releases/1.2.3/update.json");
        assert!(release.publish(&s3.client()).await.is_err());
        assert!(s3.object_keys().iter().all(|key| !is_channel_pointer(key)), "{:?}", s3.object_keys());
    }

    #[tokio::test]
    async fn reports_a_failed_channel_upload_after_trying_the_others() {
        let dir = TempDir::new();
        let release = Release::build(release_args(&dir, 0)).await.unwrap();
        let s3 = FakeS3::start().await;
        s3.deny_upload("canary.json");
        assert!(release.publish(&s3.client()).await.is_err());
        assert!(s3.object("stable.json").is_some());
        assert_eq!(s3.object("canary.json"), None);
    }

    #[tokio::test]
    async fn uploads_large_artifacts_in_parts_of_five_megabytes() {
        let s3 = FakeS3::start().await;
        let dir = TempDir::new();
        let content = vec![7u8; 5 * 1024 * 1024 + 1];
        let path = dir.write("large.dmg", &content);
        multipart_upload(&s3.client(), &path, "releases/1.2.3/large.dmg").await.unwrap();

        let parts: Vec<(String, usize)> = s3.requests().iter()
            .filter(|request| request.query.contains_key("partNumber"))
            .map(|request| (request.query["partNumber"].clone(), request.body.len()))
            .collect();
        assert_eq!(parts, vec![("1".to_string(), 5 * 1024 * 1024), ("2".to_string(), 1)]);
        assert_eq!(s3.object("releases/1.2.3/large.dmg").unwrap(), content);
    }

    #[tokio::test]
    async fn fails_for_an_artifact_that_vanished() {
        let s3 = FakeS3::start().await;
        let dir = TempDir::new();
        assert!(multipart_upload(&s3.client(), &dir.path().join("gone.dmg"), "releases/gone.dmg").await.is_err());
        assert_eq!(s3.object("releases/gone.dmg"), None);
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
