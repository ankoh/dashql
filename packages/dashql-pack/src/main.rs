mod badge;
mod coverage_badge_command;
mod git_info;
mod publish_command;
mod release;
mod release_metadata;
mod release_version;
mod remote_access;
mod remote_paths;
mod serde_date;
mod serde_version;
#[cfg(test)]
mod test_s3;
mod vacuum_command;

use anyhow::Result;
use clap::{Parser, Subcommand};
use coverage_badge_command::{coverage_badge, CoverageBadgeArgs};
use publish_command::{publish, PublishArgs};
use std::env;
use vacuum_command::{vacuum, VacuumArgs};

/// Publish and clean up DashQL native app releases
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    /// The subcommand to run
    #[command(subcommand)]
    command: CliCommand,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    Version,
    Publish(PublishArgs),
    Vacuum(VacuumArgs),
    CoverageBadge(CoverageBadgeArgs),
}

fn print_version(source_dir: &std::path::Path) -> Result<()> {
    let git_repo = git_info::collect_git_info(&source_dir.to_path_buf())?;
    println!("{}", &git_repo.version.as_semver());
    Ok(())
}

#[::tokio::main]
async fn main() -> Result<()> {
    // Setup the logger
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "info")
    }
    env_logger::init();

    // Parse arguments
    let args = Cli::try_parse()?;

    let source_dir = {
        if let Ok(dir) = std::env::var("BUILD_WORKSPACE_DIRECTORY") {
            let path = std::path::PathBuf::from(&dir);
            if path.exists() { path } else { std::env::current_dir()? }
        } else {
            std::env::current_dir()?
        }
    };

    match args.command {
        CliCommand::Version => print_version(&source_dir)?,
        CliCommand::Publish(args) => publish(args).await?,
        CliCommand::Vacuum(args) => vacuum(args).await?,
        CliCommand::CoverageBadge(args) => coverage_badge(args)?,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_subcommands() {
        assert!(matches!(Cli::try_parse_from(["pack", "version"]).unwrap().command, CliCommand::Version));
        assert!(matches!(Cli::try_parse_from(["pack", "vacuum", "--dry-run"]).unwrap().command, CliCommand::Vacuum(_)));
        assert!(matches!(
            Cli::try_parse_from(["pack", "coverage-badge", "a.dat", "b.dat", "--output", "badge.svg"]).unwrap().command,
            CliCommand::CoverageBadge(_)
        ));
        assert!(Cli::try_parse_from(["pack", "coverage-badge", "--output", "badge.svg"]).is_err());
        assert!(Cli::try_parse_from(["pack"]).is_err());
        assert!(Cli::try_parse_from(["pack", "unknown"]).is_err());
    }

    #[test]
    fn publish_needs_every_artifact() {
        assert!(Cli::try_parse_from(["pack", "publish", "--source-dir", "."]).is_err());
    }

    #[test]
    fn prints_the_version_of_a_repository() {
        let dir = test_s3::TempDir::new();
        test_s3::git_repository(dir.path(), "v1.2.3", 0);
        print_version(dir.path()).unwrap();
        let empty = test_s3::TempDir::new();
        assert!(print_version(empty.path()).is_err());
    }
}
