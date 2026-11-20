//! The bundled function catalog of Hyper: what a Hyper or Salesforce connection knows about functions before it asked
//! the engine.

use dashql_core::catalog::{Catalog, CatalogEntryId};

use super::batch::{publish_catalog_batch_sync, CatalogBatch, CatalogBatchEntry, CatalogGenerations};
use super::sql::{function_script_header, quote_identifier, CatalogSource};
use super::CatalogLoadError;
use crate::connections::Timestamp;

pub use super::prefetched_hyper_functions_sql::PREFETCHED_HYPER_FUNCTIONS_SQL;

/// The bundled functions qualified with a database, with the header of a function script
pub fn qualify_prefetched_hyper_functions(database_name: &str, updated_at: Timestamp) -> String {
    let functions =
        PREFETCHED_HYPER_FUNCTIONS_SQL.replace("\"hyper\".", &format!("{}.", quote_identifier(database_name)));
    format!("{}{functions}", function_script_header(CatalogSource::Hyper.label(), updated_at))
}

/// Publish function SQL as the descriptor of the function script of a connection, without parsing it on the catalog.
/// Fails without publishing anything if the SQL doesn't parse or declares no function. The caller sets the text of the
/// function script once this succeeded. Returns the number of functions.
pub fn load_prefetched_hyper_functions(
    catalog: &mut Catalog,
    generations: &mut CatalogGenerations,
    function_entry_id: CatalogEntryId,
    sql: &str,
) -> Result<usize, CatalogLoadError> {
    let batch = CatalogBatch::new(vec![CatalogBatchEntry {
        entry_id: function_entry_id,
        text: sql.to_string(),
        require_functions: true,
    }]);
    let counts = publish_catalog_batch_sync(catalog, generations, &batch)?;
    Ok(counts.first().map_or(0, |counts| counts.functions))
}
