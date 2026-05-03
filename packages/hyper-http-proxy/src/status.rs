use http::HeaderValue;
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CompletionStatus {
    RunningOrUnspecified,
    Finished,
    #[allow(dead_code)]
    ResultsProduced,
}

impl CompletionStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, CompletionStatus::Finished | CompletionStatus::ResultsProduced)
    }
}

/// Serialize an `Option<u64>` as a JSON string (e.g. "10") per the V3 spec quirk.
fn ser_opt_u64_as_string<S>(value: &Option<u64>, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(v) => s.serialize_str(&v.to_string()),
        None => s.serialize_none(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionStats {
    #[serde(rename = "wallClockTime")]
    pub wall_clock_time_ms: f64,
    #[serde(rename = "rowsProcessed")]
    pub rows_processed: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryStatus {
    #[serde(rename = "queryId")]
    pub query_id: String,
    #[serde(rename = "completionStatus")]
    pub completion_status: CompletionStatus,
    #[serde(
        rename = "chunkCount",
        serialize_with = "ser_opt_u64_as_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub chunk_count: Option<u64>,
    #[serde(
        rename = "rowCount",
        serialize_with = "ser_opt_u64_as_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub row_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(rename = "expirationTime", skip_serializing_if = "Option::is_none")]
    pub expiration_time: Option<String>,
    #[serde(rename = "executionStats", skip_serializing_if = "Option::is_none")]
    pub execution_stats: Option<ExecutionStats>,
}

impl QueryStatus {
    pub fn running(query_id: String) -> Self {
        QueryStatus {
            query_id,
            completion_status: CompletionStatus::RunningOrUnspecified,
            chunk_count: None,
            row_count: None,
            progress: None,
            expiration_time: None,
            execution_stats: None,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("QueryStatus serialization cannot fail")
    }

    /// The `status` response header carries this JSON payload.
    /// Returns `None` if the payload contains characters that would reject
    /// conversion to a HeaderValue (extremely unlikely for our fields).
    pub fn to_header_value(&self) -> Option<HeaderValue> {
        HeaderValue::from_str(&self.to_json()).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_and_row_counts_serialize_as_strings() {
        let s = QueryStatus {
            query_id: "abc".into(),
            completion_status: CompletionStatus::Finished,
            chunk_count: Some(3),
            row_count: Some(42),
            progress: Some(100.0),
            expiration_time: None,
            execution_stats: None,
        };
        let json = s.to_json();
        assert!(json.contains("\"chunkCount\":\"3\""), "got {}", json);
        assert!(json.contains("\"rowCount\":\"42\""), "got {}", json);
        assert!(json.contains("\"completionStatus\":\"FINISHED\""), "got {}", json);
    }

    #[test]
    fn optional_fields_are_omitted_when_none() {
        let s = QueryStatus::running("q1".into());
        let json = s.to_json();
        assert!(!json.contains("chunkCount"));
        assert!(!json.contains("rowCount"));
        assert!(!json.contains("expirationTime"));
        assert!(json.contains("\"completionStatus\":\"RUNNING_OR_UNSPECIFIED\""));
    }
}
