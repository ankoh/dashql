use super::release_version::{ReleaseChannel, ReleaseVersion};

pub struct RemotePaths {
    pub channel_metadata: Vec<&'static str>,
    pub channel_update: Vec<&'static str>,
    pub release_directory: String,
    pub release_metadata: String,
    pub release_update: String,
    pub channel: &'static str,
}

pub fn derive_remote_paths(release: &ReleaseVersion) -> RemotePaths {
    let channel_metadata = match release.channel {
        ReleaseChannel::Stable => vec!["stable.json", "canary.json"],
        ReleaseChannel::Canary => vec!["canary.json"],
    };
    let channel = match release.channel {
        ReleaseChannel::Stable => "stable",
        ReleaseChannel::Canary => "canary",
    };
    let channel_update = match release.channel {
        ReleaseChannel::Stable => vec!["stable-update.json", "canary-update.json"],
        ReleaseChannel::Canary => vec!["canary-update.json"],
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
        assert_eq!(electron_channel_manifest("canary", "x64"), "channels/canary/macos/x64/latest-mac.yml");
    }
}
