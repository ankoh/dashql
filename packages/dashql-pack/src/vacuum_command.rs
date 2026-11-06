use anyhow::Result;
use clap::Parser;
use semver::Version;
use std::collections::HashMap;

use crate::remote_access::RemoteAccess;

/// Delete all but the newest release versions from R2
#[derive(Parser, Debug)]
pub struct VacuumArgs {
    /// List the objects to delete without deleting them
    #[arg(long, required = false, default_value = "false")]
    dry_run: bool,
    /// The number of newest prerelease versions to keep
    #[arg(long, required = false, default_value_t = 10)]
    keep_latest: usize,
    /// The number of newest stable versions to keep
    #[arg(long, required = false, default_value_t = 100)]
    keep_stable: usize,
}

fn retained_versions(mut versions: Vec<Version>, keep: usize) -> (Vec<Version>, Vec<Version>) {
    versions.sort_by(|a, b| b.cmp(a));
    let deleted = versions.split_off(keep.min(versions.len()));
    (versions, deleted)
}

pub async fn vacuum(args: VacuumArgs) -> Result<()> {
    // Is a dry-run?
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    // Check R2 credentials
    let remote_access = RemoteAccess::from_env()?;
    log::info!("r2 bucket: **** (from environment)");
    log::info!("r2 access key id: **** (from environment)");
    log::info!("r2 secret access key: **** (from environment)");

    vacuum_bucket(&remote_access.r2_client(), &args).await
}

/// The objects of the versions that are not among the newest ones.
/// Stable and prerelease versions are retained separately, keys without a version are never expired.
fn expired_objects(keys: &[String], keep_latest: usize, keep_stable: usize) -> Vec<String> {
    let mut stable_objects: HashMap<Version, Vec<String>> = HashMap::new();
    let mut latest_objects: HashMap<Version, Vec<String>> = HashMap::new();
    for key in keys {
        let relative = key.strip_prefix("releases/").unwrap_or(key);
        let version_text = &relative[..relative.find('/').unwrap_or(relative.len())];
        let Ok(version) = semver::Version::parse(version_text) else { continue };
        let objects = if version.pre.is_empty() {
            stable_objects.entry(version).or_default()
        } else {
            latest_objects.entry(version).or_default()
        };
        objects.push(key.clone());
    }

    let (keep_latest, delete_latest) = retained_versions(latest_objects.keys().cloned().collect(), keep_latest);
    let (keep_stable, delete_stable) = retained_versions(stable_objects.keys().cloned().collect(), keep_stable);

    log::info!("keep prerelease versions: {:?}", keep_latest);
    log::info!("keep stable versions: {:?}", keep_stable);
    log::info!("delete stable versions: {:?}", delete_stable);
    log::info!("delete prerelease versions: {:?}", delete_latest);

    let latest = delete_latest.iter().flat_map(|v| latest_objects[v].iter());
    let stable = delete_stable.iter().flat_map(|v| stable_objects[v].iter());
    latest.chain(stable).cloned().collect()
}

/// List every object of the versioned release directories
async fn list_release_objects(client: &aws_sdk_s3::Client) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    let mut continuation_token: Option<String> = None;
    loop {
        let results = client
            .list_objects_v2()
            .bucket("dashql-get")
            .prefix("releases/")
            .set_continuation_token(continuation_token)
            .send()
            .await?;
        keys.extend(results.contents().iter().filter_map(|entry| entry.key()).map(str::to_owned));
        continuation_token = results.next_continuation_token().map(str::to_owned);
        if continuation_token.is_none() { break; }
    }
    Ok(keys)
}

async fn vacuum_bucket(client: &aws_sdk_s3::Client, args: &VacuumArgs) -> Result<()> {
    let keys = list_release_objects(client).await?;
    let expired = expired_objects(&keys, args.keep_latest, args.keep_stable);
    log::info!("delete objects: {:?}", expired);

    if !args.dry_run {
        for chunk in expired.chunks(1000) {
            let objects = chunk
                .iter()
                .map(|key| aws_sdk_s3::types::ObjectIdentifier::builder().key(key).build())
                .collect::<Result<Vec<_>, _>>()?;
            let objects = aws_sdk_s3::types::Delete::builder().set_objects(Some(objects)).build()?;
            let result = client
                .delete_objects()
                .bucket("dashql-get")
                .delete(objects)
                .send()
                .await?;
            if !result.errors().is_empty() {
                return Err(anyhow::anyhow!("R2 failed to delete objects: {:?}", result.errors()));
            }
            log::info!("deleted {} objects", chunk.len());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_s3::{FakeS3, ENV_LOCK};

    const R2_ENV: [&str; 3] = ["DASHQL_GET_R2_ENDPOINT", "DASHQL_GET_R2_ACCESS_KEY_ID", "DASHQL_GET_R2_SECRET_ACCESS_KEY"];

    fn keys(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    /// The objects of the versions, one metadata file and one artifact per version
    fn objects_of(versions: &[&str]) -> Vec<String> {
        versions.iter()
            .flat_map(|version| [format!("releases/{version}/metadata.json"), format!("releases/{version}/macos/arm64/DashQL.dmg")])
            .collect()
    }

    fn args(keep_latest: usize, keep_stable: usize, dry_run: bool) -> VacuumArgs {
        VacuumArgs { dry_run, keep_latest, keep_stable }
    }

    fn sorted(mut values: Vec<String>) -> Vec<String> {
        values.sort();
        values
    }

    #[test]
    fn retention_keeps_newest_versions() {
        let versions = ["1.0.0-dev.1", "1.0.0-dev.3", "1.0.0-dev.2"]
            .into_iter().map(|value| Version::parse(value).unwrap()).collect();
        let (keep, delete) = retained_versions(versions, 2);
        assert_eq!(keep, vec![Version::parse("1.0.0-dev.3").unwrap(), Version::parse("1.0.0-dev.2").unwrap()]);
        assert_eq!(delete, vec![Version::parse("1.0.0-dev.1").unwrap()]);
    }

    #[test]
    fn retention_compares_versions_as_numbers_not_as_text() {
        let versions = ["1.9.0", "1.10.0", "1.2.0"].into_iter().map(|value| Version::parse(value).unwrap()).collect();
        let (keep, delete) = retained_versions(versions, 1);
        assert_eq!(keep, vec![Version::parse("1.10.0").unwrap()]);
        assert_eq!(delete.len(), 2);

        let expired = expired_objects(&keys(&["releases/1.0.0-dev.9/a", "releases/1.0.0-dev.10/a"]), 1, 1);
        assert_eq!(expired, keys(&["releases/1.0.0-dev.9/a"]));
    }

    #[test]
    fn retention_keeps_everything_with_fewer_versions_than_allowed() {
        let (keep, delete) = retained_versions(vec![Version::new(1, 0, 0)], 10);
        assert_eq!(keep.len(), 1);
        assert!(delete.is_empty());
    }

    #[test]
    fn expires_every_object_of_a_version() {
        let expired = expired_objects(&objects_of(&["1.0.0", "2.0.0"]), 10, 1);
        assert_eq!(sorted(expired), sorted(objects_of(&["1.0.0"])));
    }

    #[test]
    fn retains_stable_and_prerelease_versions_separately() {
        // The canaries are newer than every stable version, they must not push the stable versions out
        let objects = objects_of(&["1.0.0", "1.1.0", "1.1.1-dev.1", "1.1.1-dev.2", "1.1.1-dev.3"]);
        assert_eq!(sorted(expired_objects(&objects, 2, 2)), sorted(objects_of(&["1.1.1-dev.1"])));
        assert_eq!(sorted(expired_objects(&objects, 3, 1)), sorted(objects_of(&["1.0.0"])));
    }

    #[test]
    fn never_expires_keys_without_a_version() {
        let objects = keys(&["releases/notes.txt", "releases/latest/metadata.json", "releases/1.0/metadata.json", "stable.json"]);
        assert_eq!(expired_objects(&objects, 0, 0), Vec::<String>::new());
    }

    #[test]
    fn parses_the_arguments_of_the_publish_workflow() {
        let parsed = VacuumArgs::try_parse_from(["vacuum", "--keep-stable", "100", "--keep-latest", "10"]).unwrap();
        assert!(!parsed.dry_run);
        assert_eq!((parsed.keep_stable, parsed.keep_latest), (100, 10));
    }

    #[test]
    fn dry_run_is_a_flag_and_retention_has_defaults() {
        let parsed = VacuumArgs::try_parse_from(["vacuum", "--dry-run"]).unwrap();
        assert!(parsed.dry_run);
        assert_eq!((parsed.keep_stable, parsed.keep_latest), (100, 10));
        assert!(!VacuumArgs::try_parse_from(["vacuum"]).unwrap().dry_run);
    }

    #[tokio::test]
    async fn deletes_only_the_expired_objects_of_the_bucket() {
        let s3 = FakeS3::start().await;
        s3.put_objects(objects_of(&["1.0.0", "2.0.0", "2.0.1-dev.1", "2.0.1-dev.2"]));
        s3.put_objects(keys(&["stable.json", "latest.json", "channels/stable/macos/arm64/latest-mac.yml", "releases/notes.txt"]));

        vacuum_bucket(&s3.client(), &args(1, 1, false)).await.unwrap();

        let mut expected = objects_of(&["2.0.0", "2.0.1-dev.2"]);
        expected.extend(keys(&["stable.json", "latest.json", "channels/stable/macos/arm64/latest-mac.yml", "releases/notes.txt"]));
        assert_eq!(s3.object_keys(), sorted(expected));
    }

    #[tokio::test]
    async fn only_lists_the_release_directories() {
        let s3 = FakeS3::start().await;
        vacuum_bucket(&s3.client(), &args(1, 1, false)).await.unwrap();
        let requests = s3.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].query.get("prefix").map(String::as_str), Some("releases/"));
    }

    #[tokio::test]
    async fn dry_run_lists_but_deletes_nothing() {
        let s3 = FakeS3::start().await;
        s3.put_objects(objects_of(&["1.0.0", "2.0.0"]));
        vacuum_bucket(&s3.client(), &args(0, 0, true)).await.unwrap();
        assert_eq!(s3.object_keys(), sorted(objects_of(&["1.0.0", "2.0.0"])));
        assert!(s3.requests().iter().all(|request| request.method == "GET"));
    }

    #[tokio::test]
    async fn sees_the_newest_versions_on_later_pages() {
        // A version on the last page decides what expires, stopping early would delete the newest kept version
        let s3 = FakeS3::start().await;
        s3.set_page_size(3);
        s3.put_objects(objects_of(&["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"]));
        vacuum_bucket(&s3.client(), &args(1, 1, false)).await.unwrap();
        assert_eq!(s3.object_keys(), sorted(objects_of(&["1.0.4"])));
        assert!(s3.requests().iter().filter(|request| request.method == "GET").count() > 1);
    }

    #[tokio::test]
    async fn deletes_in_batches_of_a_thousand_objects() {
        let s3 = FakeS3::start().await;
        s3.set_page_size(1000);
        let mut objects: Vec<String> = (0..2500).map(|i| format!("releases/1.0.0/file{i}")).collect();
        objects.extend(keys(&["releases/2.0.0/metadata.json"]));
        s3.put_objects(objects);

        vacuum_bucket(&s3.client(), &args(0, 1, false)).await.unwrap();

        assert_eq!(s3.object_keys(), keys(&["releases/2.0.0/metadata.json"]));
        let batches: Vec<usize> = s3.requests().iter()
            .filter(|request| request.method == "POST")
            .map(|request| String::from_utf8_lossy(&request.body).matches("<Key>").count())
            .collect();
        assert_eq!(batches, vec![1000, 1000, 500]);
    }

    #[tokio::test]
    async fn deletes_nothing_when_the_listing_fails() {
        let s3 = FakeS3::start().await;
        s3.put_objects(objects_of(&["1.0.0", "2.0.0"]));
        s3.deny_listing();
        assert!(vacuum_bucket(&s3.client(), &args(0, 0, false)).await.is_err());
        assert_eq!(s3.object_keys().len(), 4);
    }

    #[tokio::test]
    async fn reports_objects_that_could_not_be_deleted() {
        let s3 = FakeS3::start().await;
        s3.put_objects(objects_of(&["1.0.0", "2.0.0"]));
        s3.keep_object("releases/1.0.0/metadata.json");
        let error = vacuum_bucket(&s3.client(), &args(0, 1, false)).await.unwrap_err();
        assert!(error.to_string().contains("failed to delete"), "{error}");
    }

    #[tokio::test]
    async fn stops_at_the_first_failed_batch() {
        let s3 = FakeS3::start().await;
        s3.set_page_size(1000);
        s3.put_objects((0..1500).map(|i| format!("releases/1.0.0/file{i:04}")).collect());
        s3.deny_deletes();
        assert!(vacuum_bucket(&s3.client(), &args(0, 0, false)).await.is_err());
        assert_eq!(s3.requests().iter().filter(|request| request.method == "POST").count(), 1);
        assert_eq!(s3.object_keys().len(), 1500);
    }

    #[tokio::test]
    async fn the_command_reads_the_bucket_from_the_environment() {
        let _guard = ENV_LOCK.lock().await;
        let s3 = FakeS3::start().await;
        s3.put_objects(objects_of(&["1.0.0", "2.0.0"]));
        std::env::set_var(R2_ENV[0], s3.endpoint());
        std::env::set_var(R2_ENV[1], "key");
        std::env::set_var(R2_ENV[2], "secret");
        vacuum(args(0, 1, false)).await.unwrap();
        assert_eq!(s3.object_keys(), sorted(objects_of(&["2.0.0"])));
        vacuum(args(0, 0, true)).await.unwrap();
        assert_eq!(s3.object_keys(), sorted(objects_of(&["2.0.0"])));
    }

    #[tokio::test]
    async fn the_command_needs_credentials() {
        let _guard = ENV_LOCK.lock().await;
        for name in R2_ENV {
            std::env::remove_var(name);
        }
        let error = vacuum(args(0, 0, false)).await.unwrap_err();
        assert!(error.to_string().contains("DASHQL_GET_R2_ENDPOINT"), "{error}");
    }
}
