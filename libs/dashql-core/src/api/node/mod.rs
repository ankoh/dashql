pub mod node_database_api;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    node_database_api::export_database_api(&mut cx)?;
    Ok(())
}
