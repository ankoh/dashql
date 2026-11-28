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
    Publish(PublishArgs),
    Vacuum(VacuumArgs),
    CoverageBadge(CoverageBadgeArgs),
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

    match args.command {
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
}
