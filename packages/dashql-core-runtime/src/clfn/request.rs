//! The request of a call: API names, path encoding, query styles, body formats, followed URLs and the origin check.
//!
//! Ported from `connections/clfn/clfn_request.ts` of `packages/dashql-runtime`.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::http::HttpRequest;
use super::json::{encode_uri_component, form_encode, js_string, to_json_text};
use super::spec::{ClientFunction, ClientFunctionAttribute, ClientFunctionSchema, ClientFunctionSpec};
use super::url::Url;
use super::ClientFunctionError;

/// The options that the runtime applies itself, they are never sent
pub const STANDARD_OPTIONS: [&str; 4] = ["_next", "_pages", "_poll", "_wait"];

/// Is an option one that the runtime applies itself?
pub fn is_standard_option(name: &str) -> bool {
    STANDARD_OPTIONS.contains(&name)
}

/// A request of a function, before a binding resolves its host
#[derive(Debug, Clone, PartialEq)]
pub struct ClientFunctionRequest {
    /// The HTTP method
    pub method: String,
    /// The name of the host in the spec
    pub host: String,
    /// The path below the host, with its base path and placeholders filled in. A followed URL has none.
    pub path: String,
    /// The query parameters, not encoded
    pub query: Vec<(String, String)>,
    /// The headers of options, not those of the binding
    pub headers: Vec<(String, String)>,
    /// The body
    pub body: Option<String>,
    /// The URL to follow instead of the path and query
    pub follow_url: Option<String>,
}

/// Where a host of a spec is on a connection, and what every request to it carries
#[derive(Debug, Clone, PartialEq)]
pub struct ClientFunctionHostTarget {
    /// The base URL
    pub base_url: Url,
    /// The headers of every request, such as the token
    pub headers: Vec<(String, String)>,
}

/// The variables in the base paths of the hosts, such as the API version
pub type ClientFunctionVariables = BTreeMap<String, String>;

/// The attribute of a name in a schema. A name means the same in all variants of a union, so any of them can answer.
fn find_schema_attribute<'a>(
    spec: &'a ClientFunctionSpec,
    schema: Option<&'a ClientFunctionSchema>,
    name: &str,
) -> Option<&'a ClientFunctionAttribute> {
    let schema = schema?;
    if let Some(own) = schema.attributes.iter().find(|a| a.name == name) {
        return Some(own);
    }
    schema
        .variants
        .iter()
        .filter_map(|variant| spec.schemas.get(variant))
        .find_map(|variant| variant.attributes.iter().find(|a| a.name == name))
}

/// A value in the spelling of the API
fn to_api_value(spec: &ClientFunctionSpec, value: &Value, attribute: Option<&ClientFunctionAttribute>, map: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(|item| to_api_value(spec, item, attribute, map)).collect()),
        // The keys of a map stay as written, the attribute holds for its values
        Value::Object(fields) if map => Value::Object(
            fields.iter().map(|(key, item)| (key.clone(), to_api_value(spec, item, attribute, false))).collect(),
        ),
        Value::Object(fields) => {
            let schema = attribute.and_then(|a| a.schema.as_ref()).and_then(|s| spec.schemas.get(s));
            let mut out = Map::new();
            for (name, field) in fields {
                let field_attribute = find_schema_attribute(spec, schema, name);
                let api_name = field_attribute.map_or(name.as_str(), ClientFunctionAttribute::api_name);
                let mapped = to_api_value(spec, field, field_attribute, field_attribute.is_some_and(|a| a.map));
                out.insert(api_name.to_string(), mapped);
            }
            Value::Object(out)
        }
        _ => value.clone(),
    }
}

/// The API value of an option
fn option_value(spec: &ClientFunctionSpec, value: &Value, attribute: Option<&ClientFunctionAttribute>) -> Value {
    to_api_value(spec, value, attribute, attribute.is_some_and(|a| a.map))
}

/// A scalar in a path, a header, a query string or a form. Anything else would be sent as `null` or `[object Object]`.
fn scalar_text(name: &str, value: &Value) -> Result<String, ClientFunctionError> {
    match value {
        Value::Null | Value::Array(_) | Value::Object(_) => {
            Err(ClientFunctionError::new(format!("the option {name} takes a string or a number here")))
        }
        _ => Ok(js_string(value)),
    }
}

/// Flatten a value to `a[b][0]=1` pairs, a null is left out
fn flatten(name: &str, value: &Value, out: &mut Vec<(String, String)>) -> Result<(), ClientFunctionError> {
    match value {
        Value::Null => {}
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                flatten(&format!("{name}[{i}]"), item, out)?;
            }
        }
        Value::Object(fields) => {
            for (key, field) in fields {
                flatten(&format!("{name}[{key}]"), field, out)?;
            }
        }
        _ => out.push((name.to_string(), scalar_text(name, value)?)),
    }
    Ok(())
}

/// Add a query option in its style
fn add_query_option(name: &str, value: &Value, style: Option<&str>, out: &mut Vec<(String, String)>) -> Result<(), ClientFunctionError> {
    match value {
        Value::Null => {}
        Value::Array(items) => match style {
            Some("deep") => flatten(name, value, out)?,
            Some("csv") => {
                let texts = items.iter().map(|item| scalar_text(name, item)).collect::<Result<Vec<_>, _>>()?;
                out.push((name.to_string(), texts.join(",")));
            }
            _ => {
                for item in items {
                    out.push((name.to_string(), scalar_text(name, item)?));
                }
            }
        },
        Value::Object(_) => flatten(name, value, out)?,
        _ => out.push((name.to_string(), scalar_text(name, value)?)),
    }
    Ok(())
}

/// Encode a value of a path. It can't reach another endpoint: a URL resolves a `.` or `..` segment and percent-encoding
/// leaves those as they are, so they are errors, and so is an empty value, which would reach the parent. A
/// multi-segment value is encoded per segment.
fn encode_path_value(name: &str, value: &Value, multi_segment: bool) -> Result<String, ClientFunctionError> {
    let text = scalar_text(name, value)?;
    let segments: Vec<&str> = if multi_segment { text.split('/').collect() } else { vec![text.as_str()] };
    if text.is_empty() || segments.iter().any(|s| *s == "." || *s == "..") {
        return Err(ClientFunctionError::new(format!("the path option {name} would reach another endpoint")));
    }
    Ok(segments.iter().map(|s| encode_uri_component(s)).collect::<Vec<_>>().join("/"))
}

/// Fill in `{name}` placeholders with text from a lookup
fn fill_placeholders(
    template: &str,
    lookup: impl Fn(&str) -> Option<String>,
    describe: impl Fn(&str) -> String,
) -> Result<String, ClientFunctionError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let (before, after) = rest.split_at(open);
        out.push_str(before);
        let inner = &after[1..];
        // A placeholder has no braces in its name, a lone brace stays as it is
        match inner.find(['{', '}']) {
            Some(close) if close > 0 && inner[close..].starts_with('}') => {
                let name = &inner[..close];
                out.push_str(&lookup(name).ok_or_else(|| ClientFunctionError::new(describe(name)))?);
                rest = &inner[close + 1..];
            }
            _ => {
                out.push('{');
                rest = inner;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

/// The base path of a host
fn base_path(spec: &ClientFunctionSpec, host: &str, variables: &dyn Fn(&str) -> Option<String>) -> Result<String, ClientFunctionError> {
    let declared = spec
        .hosts
        .get(host)
        .ok_or_else(|| ClientFunctionError::new(format!("{} has no host {host}", spec.namespace)))?;
    fill_placeholders(declared.base_path.as_deref().unwrap_or(""), variables, |name| {
        format!("the host {host} needs the variable {name}")
    })
}

/// Is a segment of a raw path a dot segment, also when it's spelled with `%2e`?
fn is_dot_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    matches!(lower.as_str(), "." | ".." | "%2e" | "%2e%2e" | ".%2e" | "%2e.")
}

/// The request of the escape hatch. Its host is a name of the spec and its path is relative, so the security rules
/// hold.
fn build_raw_request(
    spec: &ClientFunctionSpec,
    function: &ClientFunction,
    options: &Map<String, Value>,
    variables: &dyn Fn(&str) -> Option<String>,
) -> Result<ClientFunctionRequest, ClientFunctionError> {
    let label = format!("{}.{}", spec.namespace, function.name);
    let (Some(Value::String(method)), Some(Value::String(path))) = (options.get("method"), options.get("path")) else {
        return Err(ClientFunctionError::new(format!("{label} needs the options method and path")));
    };
    // A URL reads `%2e` as a dot and a backslash as a slash. A query in a path would be sent as part of the path.
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['\\', '?', '#'])
        || path.split('/').any(is_dot_segment)
    {
        return Err(ClientFunctionError::new(format!(
            "the path of {label} must be relative to its host, and any other option goes to its query"
        )));
    }
    let host = match options.get("host") {
        Some(Value::String(host)) => host.clone(),
        _ => function.host.clone().ok_or_else(|| ClientFunctionError::new(format!("{label} needs the option host")))?,
    };
    let mut query = Vec::new();
    for (name, value) in options {
        if !matches!(name.as_str(), "method" | "path" | "host" | "body") {
            add_query_option(name, value, None, &mut query)?;
        }
    }
    let body = options.get("body");
    Ok(ClientFunctionRequest {
        method: method.to_uppercase(),
        path: format!("{}{path}", base_path(spec, &host, variables)?),
        host,
        query,
        headers: if body.is_some() { vec![("Content-Type".to_string(), "application/json".to_string())] } else { vec![] },
        body: body.map(to_json_text),
        follow_url: None,
    })
}

/// Build the request of a call. The standard options are ignored. A variable that the lookup doesn't have fails.
pub fn build_client_function_request(
    spec: &ClientFunctionSpec,
    function: &ClientFunction,
    options: &Map<String, Value>,
    variables: &dyn Fn(&str) -> Option<String>,
) -> Result<ClientFunctionRequest, ClientFunctionError> {
    let label = format!("{}.{}", spec.namespace, function.name);
    if function.raw {
        let rest: Map<String, Value> =
            options.iter().filter(|(name, _)| !is_standard_option(name)).map(|(k, v)| (k.clone(), v.clone())).collect();
        return build_raw_request(spec, function, &rest, variables);
    }
    let (Some(host), Some(path)) = (&function.host, &function.path) else {
        return Err(ClientFunctionError::new(format!("{label} has no host or path")));
    };
    let has_body = function.body.is_some()
        || function.options.iter().any(|o| o.location.as_deref().is_some_and(|l| l.starts_with("body")));
    let mut path_values: BTreeMap<String, String> = BTreeMap::new();
    let mut query = Vec::new();
    let mut headers = Vec::new();
    let mut body_fields = Map::new();
    let mut root_body: Option<Value> = None;

    for (name, value) in options {
        if is_standard_option(name) {
            continue;
        }
        let attribute = function.option(name);
        let api_name = attribute.map_or(name.as_str(), ClientFunctionAttribute::api_name);
        // A name the spec doesn't list goes to the body if the function has one
        let location = attribute
            .and_then(|a| a.location.as_deref())
            .unwrap_or(if has_body { "body" } else { "query" });
        match location {
            "path" => {
                let multi_segment = attribute.is_some_and(|a| a.multi_segment);
                path_values.insert(api_name.to_string(), encode_path_value(name, value, multi_segment)?);
            }
            "query" => {
                let style = attribute.and_then(|a| a.style.as_deref());
                add_query_option(api_name, &option_value(spec, value, attribute), style, &mut query)?;
            }
            // A null leaves the header out, as on a followed URL
            "header" => {
                if !value.is_null() {
                    headers.push((api_name.to_string(), scalar_text(name, value)?));
                }
            }
            "body_root" => root_body = Some(option_value(spec, value, attribute)),
            "body" => {
                body_fields.insert(api_name.to_string(), option_value(spec, value, attribute));
            }
            other => {
                return Err(ClientFunctionError::new(format!("{label}: the option {name} has the unknown location {other}")))
            }
        }
    }

    let path = fill_placeholders(path, |name| path_values.get(name).cloned(), |name| {
        format!("{label} needs the path value {name}")
    })?;
    let mut body = None;
    let format = function.body.as_deref().unwrap_or("json");
    if root_body.is_some() || !body_fields.is_empty() {
        match format {
            "json" => {
                headers.push(("Content-Type".to_string(), "application/json".to_string()));
                body = Some(to_json_text(&root_body.unwrap_or(Value::Object(body_fields))));
            }
            "form" => {
                let mut pairs = Vec::new();
                for (name, value) in &body_fields {
                    flatten(name, value, &mut pairs)?;
                }
                headers.push(("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string()));
                body = Some(form_encode(pairs.iter().map(|(n, v)| (n.as_str(), v.as_str()))));
            }
            media_type => {
                // A media type: the body is one string option
                let mut values = body_fields.values();
                let (Some(Value::String(text)), None) = (values.next(), values.next()) else {
                    return Err(ClientFunctionError::new(format!("{label} takes a {media_type} body as one string")));
                };
                headers.push(("Content-Type".to_string(), media_type.to_string()));
                body = Some(text.clone());
            }
        }
    }
    Ok(ClientFunctionRequest {
        method: function.method.as_deref().unwrap_or("GET").to_uppercase(),
        host: host.clone(),
        path: format!("{}{path}", base_path(spec, host, variables)?),
        query,
        headers,
        body,
        follow_url: None,
    })
}

/// A request that follows a URL from a response: always a GET without a body, so it can't repeat a create. The headers
/// of options still apply, the path and query come from the URL.
pub fn follow_request(request: &ClientFunctionRequest, url: &str) -> ClientFunctionRequest {
    let headers = request.headers.iter().filter(|(name, _)| !name.eq_ignore_ascii_case("content-type")).cloned().collect();
    ClientFunctionRequest {
        method: "GET".to_string(),
        host: request.host.clone(),
        path: String::new(),
        query: Vec::new(),
        headers,
        body: None,
        follow_url: Some(url.to_string()),
    }
}

/// Resolve a URL from a response or a script. A URL on another origin never receives the token.
pub fn resolve_follow_url(base_url: &Url, url: &str) -> Result<Url, ClientFunctionError> {
    let resolved = base_url.join(url).map_err(|e| ClientFunctionError::new(e.to_string()))?;
    if resolved.origin() != base_url.origin() {
        return Err(ClientFunctionError::new(format!(
            "the URL {} is on another origin than {}",
            resolved.origin(),
            base_url.origin()
        )));
    }
    Ok(resolved)
}

/// The URL of a request on a host
pub fn request_url(request: &ClientFunctionRequest, base_url: &Url) -> Result<Url, ClientFunctionError> {
    if let Some(follow) = &request.follow_url {
        return resolve_follow_url(base_url, follow);
    }
    let base = base_url.path().strip_suffix('/').unwrap_or(base_url.path());
    Ok(base_url.with_path(&format!("{base}{}", request.path)).with_query_pairs(&request.query))
}

/// The HTTP request of a request on its host: the URL, the headers of the host and then those of the options
pub fn http_request(request: &ClientFunctionRequest, target: &ClientFunctionHostTarget) -> Result<HttpRequest, ClientFunctionError> {
    let url = request_url(request, &target.base_url)?;
    let mut headers: Vec<(String, String)> = Vec::new();
    for (name, value) in target.headers.iter().chain(request.headers.iter()) {
        // A later header replaces an earlier one, as `Headers.set` does
        headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
        headers.push((name.clone(), value.clone()));
    }
    Ok(HttpRequest { method: request.method.clone(), url: url.to_string(), headers, body: request.body.clone() })
}
