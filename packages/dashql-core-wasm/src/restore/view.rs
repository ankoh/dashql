//! The views of a restore: its progress, what it restored next to the connections and workbooks, and the script files
//! that the host reads, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts`
//! (`tsify`). See docs/wip/runtime_projection.md.

use dashql_core_runtime::restore::{ProgressCounter, RestoreProgress as RuntimeProgress, RestoredState as RuntimeState};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::connection::view::ConnectorType;
use crate::views::JsonValue;

/// A counter of the progress of a step of a restore
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoreProgressCounter {
    pub started: u32,
    pub succeeded: u32,
    pub skipped: u32,
    pub failed: u32,
    /// Null until the total is known
    pub total: Option<u32>,
}

impl From<&ProgressCounter> for RestoreProgressCounter {
    fn from(counter: &ProgressCounter) -> Self {
        RestoreProgressCounter {
            started: counter.started,
            succeeded: counter.succeeded,
            skipped: counter.skipped,
            failed: counter.failed,
            total: counter.total,
        }
    }
}

/// The progress of a restore
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoreProgress {
    pub restore_connections: RestoreProgressCounter,
    pub restore_catalogs: RestoreProgressCounter,
    pub restore_workbook_scripts: RestoreProgressCounter,
}

impl From<&RuntimeProgress> for RestoreProgress {
    fn from(progress: &RuntimeProgress) -> Self {
        RestoreProgress {
            restore_connections: (&progress.connections).into(),
            restore_catalogs: (&progress.catalogs).into(),
            restore_workbook_scripts: (&progress.workbook_scripts).into(),
        }
    }
}

/// A restored connection, the module hands out the connection by its index
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoredConnectionView {
    pub connection_id: String,
    #[tsify(type = "ConnectorType")]
    pub connector_type: ConnectorType,
}

/// A restored workbook, the module hands out the workbook by its index
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoredWorkbookView {
    pub workbook_id: String,
    pub name: Option<String>,
    /// The metadata of the workbook file, without the ephemeral marker of a promoted workbook
    pub metadata: JsonValue,
    /// The connections of the scripts and the pending connection
    pub connection_ids: Vec<String>,
}

/// A workbook that failed its validation or couldn't be restored
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoredInvalidWorkbook {
    pub workbook_id: String,
    pub title: String,
    #[tsify(type = "ConnectorType | null")]
    pub connector_type: Option<ConnectorType>,
    /// The code of the validation error, e.g. `unsupported_format_version`
    pub error: String,
}

/// What a restore restored, the connections and the workbooks in the order of their indexes
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoredStateView {
    pub connections: Vec<RestoredConnectionView>,
    pub workbooks: Vec<RestoredWorkbookView>,
    pub invalid_workbooks: Vec<RestoredInvalidWorkbook>,
    pub progress: RestoreProgress,
}

impl From<&RuntimeState> for RestoredStateView {
    fn from(state: &RuntimeState) -> Self {
        RestoredStateView {
            connections: (state.connections.iter())
                .map(|c| RestoredConnectionView {
                    connection_id: c.connection_id().to_string(),
                    connector_type: c.connector_type().into(),
                })
                .collect(),
            workbooks: (state.workbooks.iter())
                .map(|w| RestoredWorkbookView {
                    workbook_id: w.workbook.id().to_string(),
                    name: w.workbook.name().map(str::to_string),
                    metadata: JsonValue(w.metadata.clone()),
                    connection_ids: w.connection_ids.clone(),
                })
                .collect(),
            invalid_workbooks: (state.invalid_workbooks.iter())
                .map(|invalid| RestoredInvalidWorkbook {
                    workbook_id: invalid.workbook_id.clone(),
                    title: invalid.title.clone(),
                    connector_type: invalid.connector_type.map(Into::into),
                    error: invalid.error.code().to_string(),
                })
                .collect(),
            progress: (&state.progress).into(),
        }
    }
}

/// A script file of a workbook
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoreScriptFile {
    pub name: String,
    pub sql: String,
}
