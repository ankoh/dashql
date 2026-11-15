//! The views of the persistence of connections: the persisted fields before a change, the change and the outcomes of a
//! save, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts` (`tsify`). See
//! docs/wip/runtime_projection.md.

use dashql_core_runtime::storage::WriteOutcome;
use serde::Serialize;
use tsify::Tsify;

use crate::runtime::storage::view::StorageWriteOutcome;
use crate::views::JsonValue;

/// The outcome of writing the copy of a connection into a workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionCopyOutcome {
    pub workbook_id: String,
    pub result: StorageWriteOutcome,
}

pub(crate) fn copies(copies: Vec<(String, WriteOutcome)>) -> Vec<ConnectionCopyOutcome> {
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
