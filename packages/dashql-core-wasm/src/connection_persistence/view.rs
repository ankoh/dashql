//! The views of the persistence of connections: the persisted fields before a change, the change and the outcomes of a
//! save, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts` (`tsify`). See
//! docs/wip/runtime_projection.md.

use dashql_core_runtime::connection_persistence::PersistedConnection;
use dashql_core_runtime::connections::CatalogUpdateTaskStatus;
use dashql_core_runtime::storage::WriteOutcome;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::storage_writer::view::StorageWriteOutcome;
use crate::views::JsonValue;

/// What storage keeps of a connection, the fields before a change decide whether the change is written
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct PersistedConnectionFields {
    pub active: bool,
    pub params: JsonValue,
    pub params_draft: Option<JsonValue>,
    pub name: Option<String>,
    pub cache_query_results: Option<bool>,
}

impl From<PersistedConnectionFields> for PersistedConnection {
    fn from(fields: PersistedConnectionFields) -> Self {
        PersistedConnection {
            active: fields.active,
            params: fields.params.0,
            params_draft: fields.params_draft.map(|draft| draft.0).filter(|draft| !draft.is_null()),
            name: fields.name,
            cache_query_results: fields.cache_query_results,
        }
    }
}

/// How a catalog update finished
#[derive(Clone, Copy, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum CatalogUpdateFinalStatus {
    Succeeded,
    PartiallySucceeded,
    Failed,
    Cancelled,
}

impl From<CatalogUpdateFinalStatus> for CatalogUpdateTaskStatus {
    fn from(status: CatalogUpdateFinalStatus) -> Self {
        match status {
            CatalogUpdateFinalStatus::Succeeded => CatalogUpdateTaskStatus::Succeeded,
            CatalogUpdateFinalStatus::PartiallySucceeded => CatalogUpdateTaskStatus::PartiallySucceeded,
            CatalogUpdateFinalStatus::Failed => CatalogUpdateTaskStatus::Failed,
            CatalogUpdateFinalStatus::Cancelled => CatalogUpdateTaskStatus::Cancelled,
        }
    }
}

/// What changed a connection
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ConnectionPersistenceChange {
    Other,
    ParamsCommitted,
    RelationsTouched,
    /// A catalog update finished, a lookup that changed nothing (`changed` false) has nothing to save
    CatalogUpdateFinished {
        task_id: u32,
        status: CatalogUpdateFinalStatus,
        #[serde(default)]
        #[tsify(optional)]
        changed: Option<bool>,
    },
}

/// The outcome of writing the copy of a connection into a workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionCopyOutcome {
    pub workbook_id: String,
    pub result: StorageWriteOutcome,
}

pub(super) fn copies(copies: Vec<(String, WriteOutcome)>) -> Vec<ConnectionCopyOutcome> {
    let copy = |(workbook_id, outcome): (String, WriteOutcome)| ConnectionCopyOutcome { workbook_id, result: outcome.into() };
    copies.into_iter().map(copy).collect()
}

/// The outcome of saving a connection
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSaveOutcome {
    /// The saved params
    #[tsify(type = "JsonParams")]
    pub params: JsonValue,
    /// The outcome of writing the app manifest
    pub manifest: StorageWriteOutcome,
    /// The outcomes of writing the copies of the workbooks, none if the manifest wasn't written
    pub workbooks: Vec<ConnectionCopyOutcome>,
}
