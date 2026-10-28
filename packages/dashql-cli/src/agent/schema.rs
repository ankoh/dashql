//! Checks the messages of the agent bridge against its JSON Schema, for the tests of the server and the bridge.
//! It knows the keywords that proto/json/dashql/agent_bridge.json uses.
//! The bridge tests include the file as their own module.

#![allow(dead_code)]

use serde_json::{Map, Value};
use std::sync::OnceLock;

/// The definitions of proto/json/dashql/agent_bridge.json
pub struct BridgeSchema {
    definitions: Map<String, Value>,
}

impl BridgeSchema {
    /// A definition of the schema
    pub fn definition(&self, name: &str) -> Option<&Value> {
        self.definitions.get(name)
    }

    pub fn get() -> &'static BridgeSchema {
        static SCHEMA: OnceLock<BridgeSchema> = OnceLock::new();
        SCHEMA.get_or_init(|| {
            let text = include_str!("../../../../proto/json/dashql/agent_bridge.json");
            let schema: Value = serde_json::from_str(text).expect("the schema of the agent bridge is JSON");
            let definitions = schema["definitions"].as_object().expect("the schema has definitions").clone();
            BridgeSchema { definitions }
        })
    }

    /// Check a value against a definition
    pub fn check(&self, definition: &str, value: &Value) -> Result<(), String> {
        let schema = self.definitions.get(definition).ok_or(format!("unknown definition {definition}"))?;
        self.validate(schema, value, definition)
    }

    /// Check a message that a client receives on the WebSocket.
    /// `request` is the method of the client's request that a response answers.
    pub fn check_from_server(&self, message: &Value, request: Option<&str>) -> Result<(), String> {
        self.check("AgentRpcMessage", message)?;
        match (message["method"].as_str(), request) {
            (Some(method), _) => {
                let params = self.method("AgentClientMethods", method, "params")?;
                self.validate(params, &message["params"], method)
            }
            (None, _) if message.get("error").is_some() => Ok(()),
            (None, Some(method)) => {
                let result = self.method("AgentServerMethods", method, "result")?;
                self.validate(result, &message["result"], method)
            }
            (None, None) => Err(format!("a response to no request: {message}")),
        }
    }

    /// Check a message that the server receives on the WebSocket.
    /// `request` is the method of the server's request that a response answers.
    pub fn check_from_client(&self, message: &Value, request: Option<&str>) -> Result<(), String> {
        self.check("AgentRpcMessage", message)?;
        match (message["method"].as_str(), request) {
            (Some(method), _) => {
                let params = self.method("AgentServerMethods", method, "params")?;
                self.validate(params, &message["params"], method)
            }
            (None, _) if message.get("error").is_some() => Ok(()),
            (None, Some(method)) => {
                let result = self.method("AgentClientMethods", method, "result")?;
                self.validate(result, &message["result"], method)
            }
            (None, None) => Err(format!("a response to no request: {message}")),
        }
    }

    /// The schema of the params or the result of a method
    fn method(&self, methods: &str, method: &str, part: &str) -> Result<&Value, String> {
        let unknown = || format!("{methods} has no {part} for {method}");
        let definition = self.definitions.get(methods).ok_or_else(unknown)?;
        definition["properties"].get(method).and_then(|m| m["properties"].get(part)).ok_or_else(unknown)
    }

    fn validate(&self, schema: &Value, value: &Value, path: &str) -> Result<(), String> {
        let Some(schema) = schema.as_object() else { return Ok(()) };
        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            let name = reference.strip_prefix("#/definitions/").ok_or(format!("unsupported reference {reference}"))?;
            let target = self.definitions.get(name).ok_or(format!("unknown definition {name}"))?;
            return self.validate(target, value, path);
        }
        if let Some(expected) = schema.get("const") {
            if value != expected {
                return Err(format!("{path}: expected {expected}, got {value}"));
            }
        }
        if let Some(Value::Array(values)) = schema.get("enum") {
            if !values.contains(value) {
                return Err(format!("{path}: {value} is none of {}", Value::Array(values.clone())));
            }
        }
        if let Some(Value::Array(options)) = schema.get("oneOf") {
            let matching = options.iter().filter(|option| self.validate(option, value, path).is_ok()).count();
            if matching != 1 {
                return Err(format!("{path}: {value} matches {matching} schemas of oneOf"));
            }
        }
        if let Some(types) = schema.get("type") {
            let types: Vec<&str> = match types {
                Value::Array(types) => types.iter().filter_map(Value::as_str).collect(),
                types => types.as_str().into_iter().collect(),
            };
            if !types.iter().any(|t| has_type(value, t)) {
                return Err(format!("{path}: {value} is no {}", types.join(" or ")));
            }
        }
        if let Value::Object(object) = value {
            for key in schema.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                if !object.contains_key(key) {
                    return Err(format!("{path}: {key} is missing"));
                }
            }
            let properties = schema.get("properties").and_then(Value::as_object);
            for (key, item) in object {
                let path = format!("{path}.{key}");
                match (properties.and_then(|p| p.get(key)), schema.get("additionalProperties")) {
                    (Some(property), _) => self.validate(property, item, &path)?,
                    (None, Some(Value::Bool(false))) => return Err(format!("{path} is not allowed")),
                    (None, Some(additional)) => self.validate(additional, item, &path)?,
                    (None, None) => {}
                }
            }
        }
        if let (Value::Array(items), Some(schema)) = (value, schema.get("items")) {
            for (i, item) in items.iter().enumerate() {
                self.validate(schema, item, &format!("{path}[{i}]"))?;
            }
        }
        Ok(())
    }
}

fn has_type(value: &Value, name: &str) -> bool {
    match name {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defines_the_params_and_results_of_the_methods() {
        let schema = BridgeSchema::get();
        for methods in ["AgentServerMethods", "AgentClientMethods"] {
            for (method, parts) in schema.definitions[methods]["properties"].as_object().unwrap() {
                for part in parts["properties"].as_object().unwrap().values() {
                    let reference = part["$ref"].as_str().unwrap_or_else(|| panic!("{method} refers to a definition"));
                    let name = reference.strip_prefix("#/definitions/").unwrap();
                    assert!(schema.definitions.contains_key(name), "{method} refers to the unknown {name}");
                }
            }
        }
    }

    #[test]
    fn checks_messages() {
        let schema = BridgeSchema::get();
        let status = json!({ "method": "agent/status", "params": { "session": "s1", "turnId": "t1", "state": "running", "text": "" } });
        assert_eq!(schema.check_from_server(&status, None), Ok(()));
        let done = json!({ "id": 1, "result": { "turnId": "t1", "harness": "codex" } });
        assert_eq!(schema.check_from_server(&done, Some("agent/request")), Ok(()));
        let error = json!({ "id": 1, "error": { "code": "usage", "message": "no" } });
        assert_eq!(schema.check_from_server(&error, Some("agent/request")), Ok(()));
        let reply = json!({ "id": "c1", "result": { "text": "ok", "data": [1] } });
        assert_eq!(schema.check_from_client(&reply, Some("command")), Ok(()));

        let unknown = json!({ "method": "agent/other", "params": {} });
        assert!(schema.check_from_server(&unknown, None).is_err());
        let extra = json!({ "method": "agent/done", "params": { "session": "s1", "turnId": "t1", "message": "", "x": 1 } });
        assert_eq!(schema.check_from_server(&extra, None), Err("agent/done.x is not allowed".into()));
        let state = json!({ "method": "agent/status", "params": { "session": "s1", "turnId": "t1", "state": "done", "text": "" } });
        assert!(schema.check_from_server(&state, None).unwrap_err().contains("is none of"));
        let missing = json!({ "id": 1, "result": { "turnId": "t1" } });
        assert_eq!(schema.check_from_server(&missing, Some("agent/request")), Err("agent/request: harness is missing".into()));
        let failed = json!({ "ok": false, "error": { "code": "busy", "message": "" } });
        assert_eq!(schema.check("AgentCallResponse", &failed), Ok(()));
        assert!(schema.check("AgentCallResponse", &json!({ "ok": true })).is_err());
    }
}
