use crate::{remote_access::RemoteAccess, serde_date, serde_version};

use anyhow::Result;
use chrono::prelude::*;
use clap::Parser;
use semver::Version;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Parser, Debug)]
pub struct VacuumAppArgs {
    #[arg(long, default_value = "false")]
    pub dry_run: bool,
    #[arg(long, required = true, num_args = 1.., value_delimiter = ',')]
    pub keep_branches: Vec<String>,
}

#[derive(Deserialize)]
struct AppManifest {
    #[allow(dead_code)]
    branch: String,
    #[serde(with = "serde_version")]
    #[allow(dead_code)]
    version: Version,
    #[allow(dead_code)]
    git_commit: String,
    #[serde(with = "serde_date")]
    #[allow(dead_code)]
    pub_date: DateTime<Utc>,
    files: Vec<String>,
}

const MANIFESTS_PREFIX: &str = "manifests/";
const MANIFEST_FILE_PREFIX: &str = "manifest.";
const BRANCHES_PREFIX: &str = "branches/";

fn parse_manifest_key(key: &str) -> Option<(String, String)> {
    let filename = key.strip_prefix(MANIFESTS_PREFIX)?;
    let filename = filename.strip_prefix(MANIFEST_FILE_PREFIX)?;
    let filename = filename.strip_suffix(".json")?;
    // Format: <branch>.<version>
    // Version is semver like 0.0.2-dev.44 which contains dots,
    // so find the first dot followed by a digit to split branch from version.
    // Branch names can contain dots too, so we look for the pattern where
    // <digit>.<digit>.<digit> starts (the semver major.minor.patch).
    let mut best_split = None;
    for (i, _) in filename.char_indices() {
        if i > 0 && filename.as_bytes()[i - 1] == b'.' {
            let remainder = &filename[i..];
            if semver::Version::parse(remainder).is_ok() {
                best_split = Some((
                    filename[..i - 1].to_string(),
                    remainder.to_string(),
                ));
                break;
            }
        }
    }
    best_split
}

pub async fn vacuum_app(args: VacuumAppArgs) -> Result<()> {
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    let keep_set: HashSet<&str> = args.keep_branches.iter().map(|s| s.as_str()).collect();
    log::info!("keeping branches: {:?}", &args.keep_branches);

    let remote_access = RemoteAccess::from_env("DASHQL_APP", "dashql-app")?;
    log::info!("r2 bucket: {} (from environment)", &remote_access.bucket);
    let r2_client = remote_access.build_client();

    // Step 1: List all manifest objects
    let manifest_objects = list_all_objects(&r2_client, &remote_access.bucket, MANIFESTS_PREFIX).await?;
    log::info!("found {} manifest objects", manifest_objects.len());

    // Step 2: Parse manifest filenames, group by branch
    let mut manifests_by_branch: HashMap<String, Vec<String>> = HashMap::new();
    for key in &manifest_objects {
        if let Some((branch, _version)) = parse_manifest_key(key) {
            manifests_by_branch
                .entry(branch)
                .or_default()
                .push(key.clone());
        } else {
            log::warn!("skipping unparseable manifest key: {}", key);
        }
    }

    // Step 3: Partition branches
    let mut dead_manifests: Vec<String> = Vec::new();
    let mut alive_set: HashSet<String> = HashSet::new();
    let mut kept_manifest_keys: Vec<String> = Vec::new();

    for (branch, keys) in &manifests_by_branch {
        if keep_set.contains(branch.as_str()) {
            log::info!("keeping branch '{}' ({} manifests)", branch, keys.len());
            kept_manifest_keys.extend(keys.iter().cloned());
        } else {
            log::info!("deleting branch '{}' ({} manifests)", branch, keys.len());
            dead_manifests.extend(keys.iter().cloned());
        }
    }

    // Step 4: Download kept manifests and build alive set
    for key in &kept_manifest_keys {
        match download_manifest(&r2_client, &remote_access.bucket, key).await {
            Ok(manifest) => {
                for file in &manifest.files {
                    alive_set.insert(file.clone());
                }
            }
            Err(e) => {
                log::warn!("failed to download manifest {}: {}", key, e);
            }
        }
    }
    // Manifest files themselves are alive if their branch is kept
    for key in &kept_manifest_keys {
        alive_set.insert(key.clone());
    }
    log::info!("alive set contains {} entries", alive_set.len());

    // Step 5: List all objects under branches/
    let branch_objects = list_all_objects(&r2_client, &remote_access.bucket, BRANCHES_PREFIX).await?;
    log::info!("found {} objects under {}", branch_objects.len(), BRANCHES_PREFIX);

    // Step 6: Find dead files (under branches/ but not in alive set)
    let mut delete_keys: Vec<String> = Vec::new();
    for key in &branch_objects {
        if !alive_set.contains(key) {
            delete_keys.push(key.clone());
        }
    }
    // Add dead manifests
    delete_keys.extend(dead_manifests);

    log::info!("deleting {} objects", delete_keys.len());
    for key in &delete_keys {
        log::info!("  delete: {}", key);
    }

    // Step 7: Batch delete
    if !args.dry_run && !delete_keys.is_empty() {
        batch_delete(&r2_client, &remote_access.bucket, &delete_keys).await?;
        log::info!("deleted {} objects", delete_keys.len());
    }

    log::info!("vacuum-app complete");
    Ok(())
}

async fn list_all_objects(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    prefix: &str,
) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix);
        if let Some(token) = &continuation_token {
            req = req.continuation_token(token);
        }
        let result = req.send().await?;
        for obj in result.contents() {
            if let Some(key) = obj.key() {
                keys.push(key.to_string());
            }
        }
        if result.is_truncated() == Some(true) {
            continuation_token = result.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }
    Ok(keys)
}

async fn download_manifest(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
) -> Result<AppManifest> {
    let result = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await?;
    let body = result.body.collect().await?;
    let manifest: AppManifest = serde_json::from_slice(&body.into_bytes())?;
    Ok(manifest)
}

async fn batch_delete(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    keys: &[String],
) -> Result<()> {
    // R2 supports up to 1000 objects per delete request
    for chunk in keys.chunks(1000) {
        let objects: Vec<aws_sdk_s3::types::ObjectIdentifier> = chunk
            .iter()
            .map(|key| {
                aws_sdk_s3::types::ObjectIdentifier::builder()
                    .set_key(Some(key.clone()))
                    .build()
                    .unwrap()
            })
            .collect();

        let delete = aws_sdk_s3::types::Delete::builder()
            .set_objects(Some(objects))
            .build()?;

        client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_manifest_key() {
        let result = parse_manifest_key("manifests/manifest.main.0.0.2-dev.42.json");
        assert_eq!(result, Some(("main".to_string(), "0.0.2-dev.42".to_string())));

        let result = parse_manifest_key("manifests/manifest.my-feature.0.0.2-dev.44.json");
        assert_eq!(result, Some(("my-feature".to_string(), "0.0.2-dev.44".to_string())));

        let result = parse_manifest_key("manifests/manifest.main.1.0.0.json");
        assert_eq!(result, Some(("main".to_string(), "1.0.0".to_string())));

        let result = parse_manifest_key("manifests/manifest.branch.with.dots.0.0.2-dev.5.json");
        assert_eq!(result, Some(("branch.with.dots".to_string(), "0.0.2-dev.5".to_string())));

        let result = parse_manifest_key("manifests/not-a-manifest.json");
        assert_eq!(result, None);
    }
}
