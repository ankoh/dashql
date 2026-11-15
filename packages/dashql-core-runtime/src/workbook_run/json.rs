//! A statement of a run as the host reads it: the arguments of the query executor of the TypeScript runtime
//! (`QueryExecutionArgs`). The other values of a run cross as the views of the module.

use serde_json::{json, Value};

use super::{StatementCache, StatementRequest};

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
