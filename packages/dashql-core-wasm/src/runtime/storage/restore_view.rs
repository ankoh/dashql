//! The views of a restore: its progress, what it restored, the workbooks it refused, and the script files
//! that the host reads, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts`
//! (`tsify`). See docs/wip/runtime_projection.md.

use dashql_core_runtime::restore::{ProgressCounter, RestoreProgress as RuntimeProgress};
use dashql_core_runtime::workbook_format::validation::InvalidWorkbook;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::connection::view::ConnectorType;

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

/// A workbook that failed its validation or couldn't be restored
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoredInvalidWorkbook {
    pub workbook_id: String,
    pub title: String,
    #[tsify(type = "ConnectorType | null")]
    pub connector_type: Option<ConnectorType>,
    /// The code of the validation error, e.g. `unsupported_format_version`
    pub error: String,
    /// A short explanation of the error for the user
    pub description: String,
}

impl From<&InvalidWorkbook> for RestoredInvalidWorkbook {
    fn from(invalid: &InvalidWorkbook) -> Self {
        RestoredInvalidWorkbook {
            workbook_id: invalid.workbook_id.clone(),
            title: invalid.title.clone(),
            connector_type: invalid.connector_type.map(Into::into),
            error: invalid.error.code().to_string(),
            description: invalid.error.describe().to_string(),
        }
    }
}

/// What a restore restored: the connections and the workbooks that the runtime took, in order, the workbooks that were
/// refused a load and the progress
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoreOutcome {
    pub connection_ids: Vec<String>,
    pub workbook_ids: Vec<String>,
    pub invalid_workbooks: Vec<RestoredInvalidWorkbook>,
    pub progress: RestoreProgress,
}

/// A script file of a workbook
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct RestoreScriptFile {
    pub name: String,
    pub sql: String,
}
