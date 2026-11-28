use anyhow::anyhow;
use anyhow::Result;
use git2::Repository;
use lazy_static::lazy_static;
use regex::Regex;
use std::path::PathBuf;

lazy_static! {
    static ref REGEX_DESCRIBE_LONG: Regex = Regex::new("v([0-9]+).([0-9]+).([0-9]+)-([0-9]+)-g([a-f0-9]+)").unwrap();
}

/// A version derived from the long `git describe` output of a repository
#[derive(Clone)]
pub struct GitVersion {
    /// The raw `git describe` output, e.g. `v1.2.3-4-gabcdef0`
    pub description: String,
    /// The abbreviated hash of the described commit
    pub short_hash: String,
}

/// The git information of the repository a release is built from
#[derive(Clone)]
pub struct GitInfo {
    /// The version described by git
    pub version: GitVersion,
}

pub fn describe_git_version(source_dir: &PathBuf) -> Result<GitVersion> {
    // Open the current git repository
    let repo = match Repository::open(source_dir) {
        Ok(repo) => repo,
        Err(e) => return Err(anyhow!("failed to open git repository at: {}", e)),
    };
    // Resolve the git repo description
    let mut describe_opts = git2::DescribeOptions::new();
    describe_opts.describe_tags();
    let mut format_opts = git2::DescribeFormatOptions::new();
    format_opts.always_use_long_format(true);

    let description = repo.describe(&describe_opts)?;
    let description_text = description.format(Some(&format_opts))?;

    let description_parts = match REGEX_DESCRIBE_LONG.captures(&description_text) {
        Some(parts) => parts,
        None => return Err(anyhow!("git describe output is not matching version regex: {}", &description_text)),
    };

    Ok(GitVersion { description: description_text.clone(), short_hash: description_parts[5].to_string() })
}

pub fn collect_git_info(source_dir: &PathBuf) -> Result<GitInfo> {
    let version = describe_git_version(&source_dir)?;
    Ok(GitInfo { version })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_s3::{git_repository, TempDir};

    #[test]
    fn describes_a_tagged_commit() {
        let dir = TempDir::new();
        git_repository(dir.path(), "v1.2.3", 0);
        let info = collect_git_info(&dir.path().to_path_buf()).unwrap();
        assert_eq!(info.version.short_hash.len(), 7);
        assert!(info.version.description.starts_with("v1.2.3-0-g"), "{}", info.version.description);
    }

    #[test]
    fn counts_the_commits_after_the_tag() {
        let dir = TempDir::new();
        git_repository(dir.path(), "v1.2.3", 4);
        let version = describe_git_version(&dir.path().to_path_buf()).unwrap();
        assert!(version.description.starts_with("v1.2.3-4-g"), "{}", version.description);
    }

    #[test]
    fn fails_outside_of_a_repository() {
        let dir = TempDir::new();
        let error = describe_git_version(&dir.path().to_path_buf()).err().unwrap();
        assert!(error.to_string().contains("failed to open git repository"), "{error}");
    }

    #[test]
    fn fails_for_a_tag_that_is_no_version() {
        let dir = TempDir::new();
        git_repository(dir.path(), "nightly", 1);
        let error = describe_git_version(&dir.path().to_path_buf()).err().unwrap();
        assert!(error.to_string().contains("not matching version regex"), "{error}");
    }
}
