//! The status of a query of the HTTP API of Hyper: the header `x-hyperdb-status` of a query or chunk response and the
//! body of a status response.

use serde_json::Value;

use crate::query::progress::{HyperExecutionStats, HyperQueryStatus};
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress, Timestamp};

/// How far a query got. The order is the order in which a query advances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CompletionStatus {
    /// The query runs, or the server didn't say
    RunningOrUnspecified,
    /// The results are produced, the query may still run
    ResultsProduced,
    /// The query finished
    Finished,
}

impl CompletionStatus {
    /// The status of its name in the API, a running query for any other name
    pub fn from_name(name: &str) -> Self {
        match name {
            "RESULTS_PRODUCED" => CompletionStatus::ResultsProduced,
            "FINISHED" => CompletionStatus::Finished,
            _ => CompletionStatus::RunningOrUnspecified,
        }
    }

    /// The name of the status in the API
    pub fn name(self) -> &'static str {
        match self {
            CompletionStatus::RunningOrUnspecified => "RUNNING_OR_UNSPECIFIED",
            CompletionStatus::ResultsProduced => "RESULTS_PRODUCED",
            CompletionStatus::Finished => "FINISHED",
        }
    }

    /// Are the results there? The chunks of the result can be read then.
    pub fn is_completed(self) -> bool {
        matches!(self, CompletionStatus::ResultsProduced | CompletionStatus::Finished)
    }
}

/// The execution statistics of a query
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExecutionStats {
    /// The wall clock time in milliseconds
    pub wall_clock_time: f64,
    /// The rows processed
    pub rows_processed: f64,
}

/// The status of a query
#[derive(Debug, Clone, PartialEq)]
pub struct QueryStatus {
    /// The id of the query, empty if the server sent none
    pub query_id: String,
    /// How far the query got
    pub completion_status: CompletionStatus,
    /// The chunks of the result
    pub chunk_count: Option<f64>,
    /// The rows of the result
    pub row_count: Option<f64>,
    /// The progress, as the server reports it
    pub progress: Option<f64>,
    /// When the result expires, as the server wrote it
    pub expiration_time: Option<String>,
    /// The execution statistics
    pub execution_stats: Option<ExecutionStats>,
}

/// Read a number that the server may serialize as a JSON string
fn read_number(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => parse_js_number(text),
        _ => None,
    }?;
    number.is_finite().then_some(number)
}

/// A number of a string like `Number(text)`: blank is zero, otherwise a decimal or a hexadecimal, binary or octal
/// integer
fn parse_js_number(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return Some(0.0);
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0b", 2), ("0B", 2), ("0o", 8), ("0O", 8)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).ok().map(|value| value as f64);
        }
    }
    // Rust accepts `inf` and `nan`, JavaScript only `Infinity`
    if text.chars().any(|c| c.is_ascii_alphabetic() && !matches!(c, 'e' | 'E')) {
        return None;
    }
    text.parse::<f64>().ok()
}

impl QueryStatus {
    /// The status of a query that the server didn't describe yet
    pub fn new(query_id: &str) -> Self {
        Self {
            query_id: query_id.to_string(),
            completion_status: CompletionStatus::RunningOrUnspecified,
            chunk_count: None,
            row_count: None,
            progress: None,
            expiration_time: None,
            execution_stats: None,
        }
    }

    /// Read a status from a status header or a status response. The status response serializes `chunkCount` and
    /// `rowCount` as strings.
    pub fn read(raw: &Value) -> Self {
        let field = |name: &str| raw.get(name);
        let stats = field("executionStats").filter(|stats| !is_falsy(stats));
        Self {
            query_id: field("queryId").and_then(Value::as_str).unwrap_or_default().to_string(),
            completion_status: field("completionStatus")
                .and_then(Value::as_str)
                .map_or(CompletionStatus::RunningOrUnspecified, CompletionStatus::from_name),
            chunk_count: read_number(field("chunkCount")),
            row_count: read_number(field("rowCount")),
            progress: read_number(field("progress")),
            expiration_time: field("expirationTime").and_then(Value::as_str).map(str::to_string),
            execution_stats: stats.map(|stats| ExecutionStats {
                wall_clock_time: read_number(stats.get("wallClockTime")).unwrap_or(0.0),
                rows_processed: read_number(stats.get("rowsProcessed")).unwrap_or(0.0),
            }),
        }
    }

    /// Read a status from the JSON text of a status header or a status response
    pub fn parse(text: &[u8]) -> Result<Self, serde_json::Error> {
        Ok(Self::read(&serde_json::from_slice(text)?))
    }

    /// Merge a status into this one. Responses of parallel requests arrive in any order, an older status must not
    /// roll back a newer one.
    pub fn merge(&self, update: &QueryStatus) -> QueryStatus {
        let max = |a: Option<f64>, b: Option<f64>| match (a, b) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        QueryStatus {
            query_id: self.query_id.clone(),
            completion_status: self.completion_status.max(update.completion_status),
            chunk_count: max(self.chunk_count, update.chunk_count),
            row_count: max(self.row_count, update.row_count),
            progress: max(self.progress, update.progress),
            expiration_time: update.expiration_time.clone().or_else(|| self.expiration_time.clone()),
            execution_stats: match (self.execution_stats, update.execution_stats) {
                (Some(a), Some(b)) => Some(ExecutionStats {
                    wall_clock_time: a.wall_clock_time.max(b.wall_clock_time),
                    rows_processed: a.rows_processed.max(b.rows_processed),
                }),
                (a, b) => b.or(a),
            },
        }
    }

    /// The chunks of the result that the server announced
    pub fn chunks(&self) -> u64 {
        self.chunk_count.filter(|count| *count > 0.0).map_or(0, |count| count.ceil() as u64)
    }

    /// The status as the progress payload of the progress model of a query
    pub fn engine_status(&self) -> HyperQueryStatus {
        HyperQueryStatus {
            completion_status: self.completion_status.name().to_string(),
            row_count: self.row_count,
            progress: self.progress,
            execution_stats: self.execution_stats.map(|stats| HyperExecutionStats {
                wall_clock_time: stats.wall_clock_time,
                rows_processed: stats.rows_processed,
            }),
        }
    }

    /// The progress of a query with this status and the metrics of its response stream
    pub fn progress_update(&self, metrics: &QueryExecutionMetrics, received_at: Timestamp) -> QueryExecutionProgress {
        let stats = self.execution_stats;
        QueryExecutionProgress {
            is_queued: None,
            progress_percent: self.progress,
            result_rows: self.row_count.filter(|rows| *rows >= 0.0).map(|rows| rows as u64),
            rows_processed: stats.map(|stats| stats.rows_processed.max(0.0) as u64),
            execution_time_ms: stats.map(|stats| stats.wall_clock_time.round() as i64),
            metrics: metrics.clone(),
            phase: None,
            engine_progress: Some(crate::query::progress::EngineProgressPayload::HyperQueryStatus {
                status: self.engine_status(),
                received_at,
            }),
            profile_progress: None,
        }
    }
}

/// Is a JSON value falsy in JavaScript?
pub(crate) fn is_falsy(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Bool(value) => !value,
        Value::Number(number) => number.as_f64().is_none_or(|n| n == 0.0 || n.is_nan()),
        Value::String(text) => text.is_empty(),
        Value::Array(_) | Value::Object(_) => false,
    }
}
