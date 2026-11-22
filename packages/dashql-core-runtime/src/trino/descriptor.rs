//! What the Trino connector says about its params: the login hint. The default params, the draft rows and the limits
//! are the connector's (`trino::connector`).

use serde_json::Value;

use crate::connections::JsonObject;

/// The login hint of the params: the user of basic auth, none if it is empty
pub fn login_hint(params: &JsonObject) -> Option<String> {
    params
        .get("auth")
        .and_then(|auth| auth.pointer("/basic/username"))
        .and_then(Value::as_str)
        .filter(|username| !username.is_empty())
        .map(str::to_string)
}
