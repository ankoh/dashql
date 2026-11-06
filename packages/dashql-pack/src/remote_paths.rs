use super::release_version::{ReleaseChannel, ReleaseVersion};

/// The object keys a release is uploaded to
pub struct RemotePaths {
    /// The channel metadata key to point to the release, e.g. `stable.json`
    pub channel_metadata: &'static str,
    /// The channel update manifest key to point to the release, e.g. `stable-update.json`
    pub channel_update: &'static str,
    /// The versioned directory of the release, `releases/<version>`
    pub release_directory: String,
    /// The key of the release metadata
    pub release_metadata: String,
    /// The key of the release update manifest
    pub release_update: String,
    /// The name of the release channel, `stable` or `latest`
    pub channel: &'static str,
}

pub fn derive_remote_paths(release: &ReleaseVersion) -> RemotePaths {
    let (channel, channel_metadata, channel_update) = match release.channel {
        ReleaseChannel::Stable => ("stable", "stable.json", "stable-update.json"),
        ReleaseChannel::Latest => ("latest", "latest.json", "latest-update.json"),
    };
    let release_directory = format!("releases/{}", release.version.to_string());
    let release_metadata = format!("{}/{}", &release_directory, "metadata.json");
    let release_update = format!("{}/{}", &release_directory, "update.json");
    RemotePaths {
        channel_metadata,
        channel_update,
        release_directory,
        release_metadata,
        release_update,
        channel,
    }
}

pub fn electron_channel_manifest(channel: &str, arch: &str) -> String {
    format!("channels/{}/macos/{}/latest-mac.yml", channel, arch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn architecture_specific_electron_feed() {
        assert_eq!(electron_channel_manifest("stable", "arm64"), "channels/stable/macos/arm64/latest-mac.yml");
        assert_eq!(electron_channel_manifest("latest", "x64"), "channels/latest/macos/x64/latest-mac.yml");
    }

    fn release(version: &str, channel: ReleaseChannel) -> ReleaseVersion {
        ReleaseVersion { version: semver::Version::parse(version).unwrap(), id: uuid::Uuid::nil(), channel }
    }

    #[test]
    fn a_stable_release_only_moves_the_stable_channel() {
        let paths = derive_remote_paths(&release("1.2.3", ReleaseChannel::Stable));
        assert_eq!(paths.channel, "stable");
        assert_eq!(paths.channel_metadata, "stable.json");
        assert_eq!(paths.channel_update, "stable-update.json");
        assert_eq!(paths.release_directory, "releases/1.2.3");
        assert_eq!(paths.release_metadata, "releases/1.2.3/metadata.json");
        assert_eq!(paths.release_update, "releases/1.2.3/update.json");
    }

    #[test]
    fn a_prerelease_only_moves_the_latest_channel() {
        let paths = derive_remote_paths(&release("1.2.4-dev.3", ReleaseChannel::Latest));
        assert_eq!(paths.channel, "latest");
        assert_eq!(paths.channel_metadata, "latest.json");
        assert_eq!(paths.channel_update, "latest-update.json");
        assert_eq!(paths.release_directory, "releases/1.2.4-dev.3");
    }
}
