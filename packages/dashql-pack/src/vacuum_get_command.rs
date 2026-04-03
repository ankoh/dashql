use anyhow::Result;
use clap::Parser;
use semver::Version;
use std::collections::HashMap;

use crate::remote_access::RemoteAccess;

#[derive(Parser, Debug)]
pub struct VacuumGetArgs {
    #[arg(long, required = false, default_value = "false")]
    dry_run: bool,
    #[arg(long, required = false, default_value_t = 10)]
    keep_canary: usize,
    #[arg(long, required = false, default_value_t = 100)]
    keep_stable: usize,
}

pub async fn vacuum_get(args: VacuumGetArgs) -> Result<()> {
    if args.dry_run {
        log::info!("DRY RUN, no persistent changes will be made");
    }

    let remote_access = RemoteAccess::from_env("DASHQL_GET", "dashql-get")?;
    log::info!("r2 bucket: {} (from environment)", &remote_access.bucket);

    let r2_client = remote_access.build_client();

    let results = r2_client
        .list_objects_v2()
        .bucket(&remote_access.bucket)
        .prefix("releases/")
        .send()
        .await?;

    let versions = results
        .contents()
        .iter()
        .filter(|entry| entry.key().is_some())
        .map(|entry| {
            let mut p = entry.key().unwrap();
            p = p.strip_prefix("releases/").unwrap_or(p);
            p = &p[..p.find('/').unwrap_or(p.len())];
            (semver::Version::parse(p), entry)
        })
        .filter(|(version, _entry)| version.is_ok())
        .map(|(version, entry)| (version.unwrap(), entry));

    let mut stable_objects: HashMap<Version, Vec<&aws_sdk_s3::types::Object>> = HashMap::new();
    let mut canary_objects: HashMap<Version, Vec<&aws_sdk_s3::types::Object>> = HashMap::new();
    for (version, object) in versions {
        if version.pre.is_empty() {
            let objects = stable_objects.entry(version).or_insert_with(|| Vec::new());
            objects.push(object);
        } else {
            let objects = canary_objects.entry(version).or_insert_with(|| Vec::new());
            objects.push(object);
        }
    }

    let mut canary_versions: Vec<Version> = canary_objects.keys().cloned().collect();
    let mut stable_versions: Vec<Version> = stable_objects.keys().cloned().collect();
    canary_versions.sort_by(|a, b| b.cmp(a));
    stable_versions.sort_by(|a, b| b.cmp(a));

    let (keep_canary, delete_canary) =
        canary_versions.split_at(args.keep_canary.min(canary_versions.len()));
    let (keep_stable, delete_stable) =
        stable_versions.split_at(args.keep_stable.min(stable_versions.len()));

    log::info!("keep canary versions: {:?}", keep_canary);
    log::info!("keep stable versions: {:?}", keep_stable);
    log::info!("delete stable versions: {:?}", delete_stable);
    log::info!("delete canary versions: {:?}", delete_canary);

    let mut delete_objects: Vec<aws_sdk_s3::types::ObjectIdentifier> = vec![];
    for v in delete_canary.iter() {
        canary_objects
            .get(v)
            .unwrap()
            .iter()
            .map(|o| {
                aws_sdk_s3::types::ObjectIdentifier::builder()
                    .set_key(Some(o.key().unwrap().to_string()))
                    .build()
                    .unwrap()
            })
            .for_each(|o| delete_objects.push(o));
    }
    for v in delete_stable.iter() {
        stable_objects
            .get(v)
            .unwrap()
            .iter()
            .map(|o| {
                aws_sdk_s3::types::ObjectIdentifier::builder()
                    .set_key(Some(o.key().unwrap().to_string()))
                    .build()
                    .unwrap()
            })
            .for_each(|o| delete_objects.push(o));
    }
    log::info!("delete objects: {:?}", delete_objects);

    if !args.dry_run && !delete_objects.is_empty() {
        let objects = aws_sdk_s3::types::Delete::builder()
            .set_objects(Some(delete_objects))
            .build()?;
        r2_client
            .delete_objects()
            .bucket(&remote_access.bucket)
            .delete(objects)
            .send()
            .await?;
        log::info!("deleted objects");
    }

    Ok(())
}
