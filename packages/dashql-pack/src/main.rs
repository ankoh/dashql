mod git_info;
mod publish_app_command;
mod publish_get_command;
mod release;
mod release_metadata;
mod release_version;
mod remote_access;
mod remote_paths;
mod serde_date;
mod serde_version;
mod vacuum_app_command;
mod vacuum_get_command;

use anyhow::Result;
use clap::{Parser, Subcommand};
use publish_app_command::{publish_app, PublishAppArgs};
use publish_get_command::{publish_get, PublishGetArgs};
use std::env;
use vacuum_app_command::{vacuum_app, VacuumAppArgs};
use vacuum_get_command::{vacuum_get, VacuumGetArgs};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: CliCommand,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    Version,
    PublishGet(PublishGetArgs),
    VacuumGet(VacuumGetArgs),
    PublishApp(PublishAppArgs),
    VacuumApp(VacuumAppArgs),
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
        CliCommand::PublishGet(args) => publish_get(args).await?,
        CliCommand::VacuumGet(args) => vacuum_get(args).await?,
        CliCommand::PublishApp(args) => publish_app(args).await?,
        CliCommand::VacuumApp(args) => vacuum_app(args).await?,
    };
    Ok(())
}
