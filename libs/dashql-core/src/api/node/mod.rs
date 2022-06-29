pub mod node_duckdb_api;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: &mut ModuleContext) -> NeonResult<()> {
    node_duckdb_api::export_duckdb_api()?;
    Ok(())
}
