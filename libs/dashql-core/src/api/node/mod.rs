pub mod node_database_api;
pub mod node_parser_api;
pub mod node_workflow_api;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    node_database_api::export_database_api(&mut cx)?;
    node_parser_api::export_parser_api(&mut cx)?;
    Ok(())
}
