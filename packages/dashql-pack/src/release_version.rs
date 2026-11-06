use anyhow::{anyhow, Result};
use clap::ValueEnum;
use semver::Version;
use std::fmt;
use uuid::Uuid;

/// The channel a release is published to, named by the workflow that publishes it
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ReleaseChannel {
    Stable,
    Latest,
}

impl fmt::Display for ReleaseChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReleaseChannel::Stable => write!(f, "stable"),
            ReleaseChannel::Latest => write!(f, "latest"),
        }
    }
}

/// The version, id and channel of a release
pub struct ReleaseVersion {
    /// The semantic version the artifacts were built with
    pub version: Version,
    /// The release id, a UUID v5 of the version string
    pub id: Uuid,
    /// The release channel
    pub channel: ReleaseChannel,
}

const RELEASE_ID_NAMESPACE: Uuid = uuid::uuid!("444560d1-4268-44be-8016-b09f95eadbba");

pub fn build_release_version(version: Version, channel: ReleaseChannel) -> ReleaseVersion {
    let id = Uuid::new_v5(&RELEASE_ID_NAMESPACE, version.to_string().as_bytes());
    ReleaseVersion { version, id, channel }
}

/// Read the version of an electron-builder update manifest (latest-mac.yml)
pub fn read_manifest_version(manifest: &str) -> Result<Version> {
    let version = manifest
        .lines()
        .find_map(|line| line.strip_prefix("version: "))
        .ok_or_else(|| anyhow!("update manifest has no version"))?;
    Version::parse(version.trim()).map_err(|e| anyhow!("invalid version in update manifest: {}: {}", version, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn keeps_the_version_and_the_channel() {
        let release = build_release_version(version("1.2.4-dev.4"), ReleaseChannel::Latest);
        assert_eq!(release.version.to_string(), "1.2.4-dev.4");
        assert_eq!(release.channel.to_string(), "latest");
    }

    #[test]
    fn a_prerelease_sorts_after_the_tag_and_before_the_next_tag() {
        let prerelease = version("1.2.4-dev.4");
        assert!(prerelease > Version::new(1, 2, 3));
        assert!(prerelease < Version::new(1, 2, 4));
    }

    #[test]
    fn the_release_id_only_depends_on_the_version() {
        let id = build_release_version(version("1.2.4-dev.4"), ReleaseChannel::Latest).id;
        assert_eq!(build_release_version(version("1.2.4-dev.4"), ReleaseChannel::Stable).id, id);
        assert_ne!(build_release_version(version("1.2.4-dev.5"), ReleaseChannel::Latest).id, id);
    }

    #[test]
    fn reads_the_top_level_version_of_a_manifest() {
        let manifest = "version: 1.2.4-dev.4\nfiles:\n  - url: DashQL.zip\n    version: 9.9.9\npath: DashQL.zip\n";
        assert_eq!(read_manifest_version(manifest).unwrap(), version("1.2.4-dev.4"));
    }

    #[test]
    fn refuses_a_manifest_without_a_valid_version() {
        let error = read_manifest_version("path: DashQL.zip\n").unwrap_err();
        assert!(error.to_string().contains("has no version"), "{error}");
        let error = read_manifest_version("version: nightly\n").unwrap_err();
        assert!(error.to_string().contains("invalid version"), "{error}");
    }
}
