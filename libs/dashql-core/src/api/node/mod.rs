pub mod node_duckdb_api;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    node_duckdb_api::export_duckdb_api(&mut cx)?;
    Ok(())
}
