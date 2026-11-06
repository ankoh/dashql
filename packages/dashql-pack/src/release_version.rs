use super::git_info::GitVersion;
use anyhow::Result;
use semver::Version;
use std::fmt;
use uuid::Uuid;

pub enum ReleaseChannel {
    Stable,
    Canary,
}

impl fmt::Display for ReleaseChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReleaseChannel::Stable => write!(f, "stable"),
            ReleaseChannel::Canary => write!(f, "canary"),
        }
    }
}

/// The version, id and channel of a release
pub struct ReleaseVersion {
    /// The semantic version, a `dev` prerelease for untagged commits
    pub version: Version,
    /// The release id, a UUID v5 of the version string
    pub id: Uuid,
    /// The release channel, stable for tagged commits and canary otherwise
    pub channel: ReleaseChannel,
}

const RELEASE_ID_NAMESPACE: Uuid = uuid::uuid!("444560d1-4268-44be-8016-b09f95eadbba");

pub fn build_release_version(git_version: &GitVersion) -> Result<ReleaseVersion> {
    let semver = git_version.as_semver();
    let semver_text = semver.to_string();
    let id = Uuid::new_v5(&RELEASE_ID_NAMESPACE, semver_text.as_bytes());
    let channel = if git_version.iteration == 0 {
        ReleaseChannel::Stable
    } else {
        ReleaseChannel::Canary
    };
    Ok(ReleaseVersion {
        version: semver,
        id,
        channel,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_version(iteration: u32) -> GitVersion {
        GitVersion {
            description: format!("v1.2.3-{iteration}-gabc1234"),
            major: 1,
            minor: 2,
            patch: 3,
            iteration,
            short_hash: "abc1234".to_string(),
        }
    }

    #[test]
    fn a_tagged_commit_is_a_stable_release_of_the_tag() {
        let release = build_release_version(&git_version(0)).unwrap();
        assert_eq!(release.version.to_string(), "1.2.3");
        assert_eq!(release.channel.to_string(), "stable");
    }

    #[test]
    fn a_later_commit_is_a_canary_of_the_next_patch() {
        let release = build_release_version(&git_version(4)).unwrap();
        assert_eq!(release.version.to_string(), "1.2.4-dev.4");
        assert_eq!(release.channel.to_string(), "canary");
    }

    #[test]
    fn a_canary_sorts_after_the_tag_and_before_the_next_tag() {
        let canary = build_release_version(&git_version(4)).unwrap().version;
        assert!(canary > Version::new(1, 2, 3));
        assert!(canary < Version::new(1, 2, 4));
    }

    #[test]
    fn the_release_id_only_depends_on_the_version() {
        let id = build_release_version(&git_version(4)).unwrap().id;
        assert_eq!(build_release_version(&git_version(4)).unwrap().id, id);
        assert_ne!(build_release_version(&git_version(5)).unwrap().id, id);
    }
}
