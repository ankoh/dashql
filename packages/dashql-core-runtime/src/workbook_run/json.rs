//! The values of a run as the host reads them: a statement as the arguments of the query executor of the TypeScript
//! runtime (`QueryExecutionArgs`), the state of a run (`WorkbookExecutionState`), the events of scripts
//! (`ScriptRunEvent`) and the options of a run.

use serde_json::{json, Value};

use super::{PlanRun, ResultKey, RunFailure, RunFailureKind, RunOptions, RunResult, RunState, ScriptEvent, StatementCache, StatementRequest};

/// A statement as the host runs it
pub fn request_json(request: &StatementRequest) -> Value {
    let (cacheable, refresh, only, signature) = match &request.cache {
        StatementCache::None => (false, false, false, None),
        StatementCache::Refresh { signature } => (true, true, false, Some(signature.as_str())),
        StatementCache::Only { signature } => (true, false, true, Some(signature.as_str())),
    };
    let call = request.client_function_call.as_deref().and_then(|call| serde_json::from_str::<Value>(call).ok());
    json!({
        "connectionId": request.connection_id,
        "scriptKey": request.script_key,
        "query": request.text,
        "clientFunctionCall": call,
        "analyzeResults": request.analyze_results,
        "publishResults": request.publish_results,
        "cacheable": cacheable,
        "refreshCache": refresh,
        "cacheOnly": only,
        "cacheSignature": signature,
        "title": request.planned.title(),
        "description": request.planned.description(),
        "issuer": request.planned.issuer(),
        "planned": request.planned.to_json(),
    })
}

/// The state of a run
pub fn state_json(state: &RunState) -> Value {
    json!({
        "phase": state.phase.name(),
        "totalScripts": state.total_scripts,
        "completedScripts": state.completed_scripts,
        "totalStatements": state.total_statements,
        "completedStatements": state.completed_statements,
        "activeFileName": state.active_file_name,
        "activeStatementIndex": state.active_statement_index,
        "activeStatementCount": state.active_statement_count,
        "error": state.error,
        "skippedScripts": state.skipped_scripts,
        "skippedFiles": state.skipped_files,
    })
}

/// The failure of a run, without what the host failed with
pub fn failure_json(failure: &RunFailure) -> Value {
    let kind = match failure.kind {
        RunFailureKind::Plan => "plan",
        RunFailureKind::Cancelled => "cancelled",
        RunFailureKind::Error => "error",
    };
    json!({ "kind": kind, "message": failure.message, "hostValue": failure.value.is_some() })
}

/// An event of a script, a failure goes without what the host failed with
pub fn event_json(event: &ScriptEvent) -> Value {
    match event {
        ScriptEvent::Planned { follows } => json!({ "type": "planned", "follows": follows }),
        ScriptEvent::Cached { key, query_id } => json!({ "type": "cached", "key": key, "queryId": query_id }),
        ScriptEvent::Skipped { reason } => json!({ "type": "skipped", "reason": reason }),
        ScriptEvent::Started => json!({ "type": "started" }),
        ScriptEvent::Done { key, query_id } => json!({ "type": "done", "key": key, "queryId": query_id }),
        ScriptEvent::Failed { failure } => json!({ "type": "failed", "failure": failure_json(failure) }),
        ScriptEvent::Cancelled => json!({ "type": "cancelled" }),
    }
}

/// How a run ended, without what the host failed with
pub fn result_json(result: &RunResult) -> Value {
    json!({
        "outputs": result.outputs,
        "failure": result.failure.as_ref().map(failure_json),
        "launched": result.launched,
    })
}

/// The result keys of the scripts of a plan
pub fn keys_json(keys: &[Option<ResultKey>]) -> Value {
    Value::Array(
        keys.iter()
            .map(|key| match key {
                Some(key) => json!({ "key": key.key, "signature": key.signature, "reusable": key.reusable }),
                None => Value::Null,
            })
            .collect(),
    )
}

/// The options of a run: `run` is `workbook` or `script` with its `target`, `targets` the indexes of the target
/// scripts, `inputs` the names of changed inputs
pub fn options_from_json(value: &Value) -> RunOptions {
    let run = match (value.get("run").and_then(Value::as_str), value.get("target").and_then(Value::as_str)) {
        (Some("script"), Some(target)) => PlanRun::Script(target.to_string()),
        _ => PlanRun::Workbook,
    };
    let targets = value
        .get("targets")
        .and_then(Value::as_array)
        .map(|targets| targets.iter().filter_map(Value::as_u64).filter_map(|t| u32::try_from(t).ok()).collect());
    let inputs = value
        .get("inputs")
        .and_then(Value::as_array)
        .map(|inputs| inputs.iter().filter_map(Value::as_str).map(str::to_string).collect());
    RunOptions {
        run,
        targets,
        inputs,
        refresh: value.get("refresh").and_then(Value::as_bool).unwrap_or(false),
        reports_state: value.get("reportsState").and_then(Value::as_bool).unwrap_or(false),
    }
}
