//! The runtime of client functions against made-up specs and responses. A fake host answers the requests of a run in
//! order and moves its clock when the run waits.

use std::collections::VecDeque;
use std::rc::Rc;

use arrow_array::cast::AsArray;
use arrow_array::types::{Date32Type, Int32Type, Int64Type, TimestampMillisecondType};
use dashql_core_runtime::clfn::*;
use dashql_core_runtime::http::Url;
use serde_json::{json, Value};

const BASE: &str = "https://svc.example.com";

fn merge(mut base: Value, extra: Value) -> Value {
    if let (Some(base), Value::Object(extra)) = (base.as_object_mut(), extra) {
        base.extend(extra);
    }
    base
}

fn spec_with(functions: Vec<Value>, extra: Value) -> Rc<ClientFunctionSpec> {
    let functions: Vec<Value> =
        functions.into_iter().map(|f| merge(json!({ "method": "GET", "host": "api", "path": "/items" }), f)).collect();
    let spec = merge(
        json!({
            "format": 1,
            "namespace": "t",
            "hosts": { "api": { "base_path": "/v{version}" } },
            "errors": { "message": ["/error/message", "/message"] },
            "functions": functions,
        }),
        extra,
    );
    Rc::new(ClientFunctionSpec::from_value(spec).unwrap())
}

fn spec(functions: Vec<Value>) -> Rc<ClientFunctionSpec> {
    spec_with(functions, json!({}))
}

fn call(name: &str, options: Value) -> ClientFunctionCallDescription {
    ClientFunctionCallDescription {
        namespace: "t".into(),
        function: name.into(),
        effect: "read".into(),
        explain: false,
        options: options.as_object().cloned().unwrap_or_default(),
        bindings: Vec::new(),
    }
}

fn json_response(body: Value) -> HttpResponse {
    HttpResponse::new(200, body.to_string())
}

fn status(status: u16, body: Value) -> HttpResponse {
    HttpResponse::new(status, body.to_string())
}

/// A host that answers with the given responses in order
struct Host {
    responses: VecDeque<HttpResponse>,
    sent: Vec<HttpRequest>,
    sleeps: Vec<f64>,
    now: f64,
}

impl Host {
    fn new(responses: Vec<HttpResponse>) -> Self {
        Self { responses: responses.into(), sent: Vec::new(), sleeps: Vec::new(), now: 0.0 }
    }

    fn target() -> ClientFunctionHostTarget {
        ClientFunctionHostTarget {
            base_url: Url::parse(BASE).unwrap(),
            headers: vec![("Authorization".into(), "Bearer token".into())],
        }
    }

    /// Run a call to its end
    fn run(
        &mut self,
        spec: &Rc<ClientFunctionSpec>,
        description: &ClientFunctionCallDescription,
    ) -> Result<ClientFunctionResult, ClientFunctionError> {
        let variables = ClientFunctionVariables::from([("version".to_string(), "2".to_string())]);
        let (mut run, mut step) = ClientFunctionCallRun::start(spec.clone(), description, variables, self.now)?;
        // The rows come page by page
        let mut result = ClientFunctionResult { fields: run.fields(), rows: Vec::new() };
        loop {
            if let Some(rows) = run.take_rows() {
                result.rows.extend(rows.rows);
            }
            step = match step {
                CallStep::Send(request) => {
                    let request = http_request(&request, &Host::target())?;
                    self.sent.push(request);
                    let response = self.responses.pop_front().expect("unexpected request");
                    run.on_response(response, self.now)?
                }
                CallStep::Sleep { ms } => {
                    self.sleeps.push(ms);
                    self.now += ms;
                    run.on_wake(self.now)?
                }
                CallStep::Done => return Ok(result),
            };
        }
    }

    fn url(&self, i: usize) -> &str {
        &self.sent[i].url
    }

    fn body(&self, i: usize) -> Value {
        serde_json::from_str(self.sent[i].body.as_deref().unwrap()).unwrap()
    }
}

/// Run a call that must succeed
fn run(
    spec: &Rc<ClientFunctionSpec>,
    description: ClientFunctionCallDescription,
    responses: Vec<HttpResponse>,
) -> (ClientFunctionResult, Host) {
    let mut host = Host::new(responses);
    let result = host.run(spec, &description).unwrap();
    (result, host)
}

/// Run a call that must fail, and nothing else must be asked
fn fail(
    spec: &Rc<ClientFunctionSpec>,
    description: ClientFunctionCallDescription,
    responses: Vec<HttpResponse>,
) -> (ClientFunctionError, Host) {
    let mut host = Host::new(responses);
    let error = host.run(spec, &description).unwrap_err();
    (error, host)
}

fn text(result: &ClientFunctionResult, row: usize, column: &str) -> Option<String> {
    match result.cell(row, column).unwrap() {
        Cell::Null => None,
        Cell::Utf8(text) => Some(text.clone()),
        other => panic!("{column} is no text: {other:?}"),
    }
}

fn json_cell(result: &ClientFunctionResult, row: usize, column: &str) -> Value {
    serde_json::from_str(&text(result, row, column).unwrap()).unwrap()
}

fn status_of(result: &ClientFunctionResult, row: usize) -> Cell {
    result.cell(row, "_status").unwrap().clone()
}

/// The query of a URL as pairs
fn query(url: &str) -> Vec<(String, String)> {
    let query = url.split_once('?').map_or("", |(_, q)| q);
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.replace('+', " ").into_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            out.push(u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap(), 16).unwrap());
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

fn param(url: &str, name: &str) -> Option<String> {
    query(url).into_iter().find(|(n, _)| n == name).map(|(_, v)| v)
}

fn path(url: &str) -> String {
    let rest = url.strip_prefix(BASE).unwrap();
    rest.split('?').next().unwrap().to_string()
}

// The maps

#[test]
fn keeps_the_keys_of_a_map_and_spells_its_values_like_the_api() {
    let owner = json!({ "Owner": { "attributes": [{ "name": "first_name", "api_name": "firstName" }] } });
    let options = json!([{ "name": "owners", "api_name": "ownerMap", "in": "body", "schema": "Owner", "map": true }]);
    let s =
        spec_with(vec![json!({ "name": "create", "method": "POST", "options": options })], json!({ "schemas": owner }));
    let (_, host) = run(
        &s,
        call("create", json!({ "owners": { "first_name": { "first_name": "A" } } })),
        vec![json_response(json!({}))],
    );
    assert_eq!(host.body(0), json!({ "ownerMap": { "first_name": { "firstName": "A" } } }));
    let (_, host) = run(
        &s,
        call("create", json!({ "owners": [{ "a": { "first_name": "A" } }, { "b": { "first_name": "B" } }] })),
        vec![json_response(json!({}))],
    );
    assert_eq!(host.body(0), json!({ "ownerMap": [{ "a": { "firstName": "A" } }, { "b": { "firstName": "B" } }] }));
}

// The polls

#[test]
fn does_not_send_a_write_again_for_a_poll_value_that_only_a_repeated_request_has() {
    let s = spec(vec![
        json!({ "name": "create", "method": "POST", "effect": "write", "pending": { "status": 202, "poll": { "header": "Location" } } }),
    ]);
    let (error, host) = fail(&s, call("create", json!({ "_poll": "same" })), vec![]);
    assert!(error.message.contains("polls a URL"), "{error}");
    assert!(host.sent.is_empty());
}

// Responses with nested rows

#[test]
fn keeps_everything_but_the_rows_in_meta() {
    let s = spec(vec![json!({ "name": "list", "rows": "/queryResults/queryData/rows" })]);
    let body = json!({ "queryResults": { "queryData": { "columns": ["a"], "rows": [{ "a": 1 }] }, "queryMetadata": { "id": 1 } }, "status": "ok" });
    let (result, _) = run(&s, call("list", json!({})), vec![json_response(body)]);
    assert_eq!(
        json_cell(&result, 0, "_meta"),
        json!({ "queryResults": { "queryData": { "columns": ["a"] }, "queryMetadata": { "id": 1 } }, "status": "ok" })
    );
}

#[test]
fn leaves_out_the_objects_that_only_held_the_rows() {
    let nested = spec(vec![json!({ "name": "list", "rows": "/a/b/rows" })]);
    let (result, _) =
        run(&nested, call("list", json!({})), vec![json_response(json!({ "a": { "b": { "rows": [{}] } }, "c": 1 }))]);
    assert_eq!(text(&result, 0, "_meta").as_deref(), Some("{\"c\":1}"));
    let nothing = spec(vec![json!({ "name": "list", "rows": "/a/rows" })]);
    let (result, _) = run(&nothing, call("list", json!({})), vec![json_response(json!({ "a": { "rows": [{}] } }))]);
    assert_eq!(text(&result, 0, "_meta"), None);
}

#[test]
fn does_not_change_the_fields_that_it_keeps_for_paging() {
    let s = spec(vec![json!({
        "name": "list", "rows": "/collection/items", "options": [{ "name": "token", "in": "query" }],
        "paging": { "kind": "token", "from": { "body": "/collection/next" }, "option": "token" },
    })]);
    let pages = vec![
        json_response(json!({ "collection": { "items": [{}], "next": "a" } })),
        json_response(json!({ "collection": { "items": [] } })),
    ];
    let (result, host) = run(&s, call("list", json!({ "_pages": 2 })), pages);
    assert_eq!(param(host.url(1), "token").as_deref(), Some("a"));
    assert_eq!(text(&result, 0, "_meta").as_deref(), Some("{\"collection\":{\"next\":\"a\"}}"));
}

// Responses without the rows of the spec

fn token_list() -> Rc<ClientFunctionSpec> {
    spec(vec![json!({
        "name": "list", "rows": "/items", "columns": [{ "name": "id" }], "options": [{ "name": "token", "in": "query" }],
        "paging": { "kind": "token", "from": { "body": "/next" }, "option": "token" },
    })])
}

#[test]
fn keeps_the_body_in_raw_and_ends_the_list() {
    for (response, raw) in [
        (HttpResponse::new(200, "<html>login</html>"), "\"<html>login</html>\""),
        (json_response(json!({ "records": [{ "id": 1 }], "next": "a" })), "{\"records\":[{\"id\":1}],\"next\":\"a\"}"),
        (json_response(json!({ "items": { "id": 1 } })), "{\"items\":{\"id\":1}}"),
    ] {
        let (result, host) = run(&token_list(), call("list", json!({ "_pages": 3 })), vec![response]);
        assert_eq!(host.sent.len(), 1);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(text(&result, 0, "id"), None);
        assert_eq!(status_of(&result, 0), Cell::Int32(200));
        assert_eq!(text(&result, 0, "_raw").as_deref(), Some(raw));
    }
}

#[test]
fn reads_an_empty_list_from_a_null_an_empty_object_and_no_body() {
    for response in [json_response(json!({ "items": null })), json_response(json!({})), HttpResponse::new(204, "")] {
        let (result, _) = run(&token_list(), call("list", json!({})), vec![response]);
        assert!(result.rows.is_empty());
    }
}

#[test]
fn keeps_the_rows_of_the_pages_before_it() {
    let (result, _) = run(
        &token_list(),
        call("list", json!({ "_pages": 3 })),
        vec![json_response(json!({ "items": [{ "id": 1 }], "next": "a" })), json_response(json!({ "error": "gone" }))],
    );
    assert_eq!(result.rows.len(), 2);
    assert_eq!(text(&result, 0, "id").as_deref(), Some("1"));
    assert_eq!(text(&result, 1, "_raw").as_deref(), Some("{\"error\":\"gone\"}"));
}

// The requests

fn create_fn() -> Value {
    json!({
        "name": "create", "effect": "read", "method": "POST", "path": "/projects/{project}/items",
        "options": [
            { "name": "project", "in": "path" },
            { "name": "page_size", "api_name": "pageSize", "in": "query" },
            { "name": "tags", "api_name": "tagList", "in": "query", "style": "csv" },
            { "name": "ids", "in": "query" },
            { "name": "created", "in": "query", "style": "deep" },
            { "name": "trace_id", "api_name": "X-Trace-Id", "in": "header" },
            { "name": "display_name", "api_name": "displayName", "in": "body" },
            { "name": "owner", "api_name": "ownerInfo", "in": "body", "schema": "Owner" },
        ],
    })
}

fn owner_schemas() -> Value {
    json!({ "Owner": { "attributes": [{ "name": "first_name", "api_name": "firstName" }, { "name": "parent", "api_name": "parentOwner", "schema": "Owner" }] } })
}

#[test]
fn sends_the_api_names_of_the_variants_of_a_union() {
    let schemas = merge(
        owner_schemas(),
        json!({
            "Team": { "attributes": [{ "name": "team_name", "api_name": "teamName" }, { "name": "lead", "api_name": "teamLead", "schema": "Owner" }] },
            "Person": { "attributes": [{ "name": "full_name", "api_name": "fullName" }] },
            "Assignee": { "variants": ["Team", "Person"] },
        }),
    );
    let assign = json!({ "name": "assign", "method": "POST", "effect": "read", "path": "/assign", "options": [{ "name": "to", "api_name": "assignTo", "in": "body", "schema": "Assignee" }] });
    let s = spec_with(vec![assign], json!({ "schemas": schemas }));
    let (_, host) = run(
        &s,
        call("assign", json!({ "to": { "team_name": "T", "lead": { "first_name": "A" }, "other_key": 1 } })),
        vec![json_response(json!({}))],
    );
    assert_eq!(
        host.body(0),
        json!({ "assignTo": { "teamName": "T", "teamLead": { "firstName": "A" }, "other_key": 1 } })
    );
}

#[test]
fn sends_the_api_names_from_the_spec() {
    let s = spec_with(vec![create_fn()], json!({ "schemas": owner_schemas() }));
    let options = json!({
        "project": "a b/c", "page_size": 5, "tags": ["x", "y"], "ids": [1, 2], "created": { "gte": 1 }, "trace_id": "abc",
        "display_name": "Name", "owner": { "first_name": "A", "parent": [{ "first_name": "B", "other_key": 1 }] },
    });
    let (_, host) = run(&s, call("create", options), vec![json_response(json!({}))]);
    let url = host.url(0);
    assert_eq!(path(url), "/v2/projects/a%20b%2Fc/items");
    assert_eq!(param(url, "pageSize").as_deref(), Some("5"));
    assert_eq!(param(url, "tagList").as_deref(), Some("x,y"));
    assert_eq!(query(url).iter().filter(|(n, _)| n == "ids").map(|(_, v)| v.as_str()).collect::<Vec<_>>(), ["1", "2"]);
    assert_eq!(param(url, "created[gte]").as_deref(), Some("1"));
    let request = &host.sent[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.header("Authorization"), Some("Bearer token"));
    assert_eq!(request.header("X-Trace-Id"), Some("abc"));
    assert_eq!(request.header("Content-Type"), Some("application/json"));
    assert_eq!(
        host.body(0),
        json!({ "displayName": "Name", "ownerInfo": { "firstName": "A", "parentOwner": [{ "firstName": "B", "other_key": 1 }] } })
    );
}

#[test]
fn sends_a_name_the_spec_does_not_list_as_written() {
    let s = spec(vec![create_fn()]);
    let (_, host) = run(&s, call("create", json!({ "project": "a", "new_Field": 1 })), vec![json_response(json!({}))]);
    assert_eq!(host.body(0), json!({ "new_Field": 1 }));
    let (_, host) = run(
        &spec(vec![json!({ "name": "list" })]),
        call("list", json!({ "new_Field": 1 })),
        vec![json_response(json!({}))],
    );
    assert_eq!(param(host.url(0), "new_Field").as_deref(), Some("1"));
}

#[test]
fn keeps_path_values_on_their_endpoint() {
    let s = spec(vec![
        json!({ "name": "read", "path": "/files/{path}", "options": [{ "name": "path", "in": "path", "multi_segment": true }] }),
    ]);
    let (_, host) = run(&s, call("read", json!({ "path": "a b/c" })), vec![json_response(json!({}))]);
    assert_eq!(path(host.url(0)), "/v2/files/a%20b/c");
    let (error, _) = fail(&s, call("read", json!({ "path": "../admin" })), vec![]);
    assert!(error.message.contains("would reach another endpoint"), "{error}");
}

#[test]
fn never_turns_a_value_into_another_endpoint() {
    let s = spec(vec![
        json!({ "name": "remove", "method": "DELETE", "path": "/connections/{id}/actions/run", "options": [{ "name": "id", "in": "path" }] }),
    ]);
    for id in [json!(".."), json!("."), json!(""), json!(null), json!({ "a": 1 }), json!(["a", "b"])] {
        let (_, host) = fail(&s, call("remove", json!({ "id": id })), vec![]);
        assert!(host.sent.is_empty());
    }
}

#[test]
fn encodes_what_only_looks_like_a_relative_segment() {
    let s = spec(vec![json!({ "name": "read", "path": "/files/{id}/x", "options": [{ "name": "id", "in": "path" }] })]);
    let (_, host) = run(&s, call("read", json!({ "id": "%2e%2e" })), vec![json_response(json!({}))]);
    assert_eq!(path(host.url(0)), "/v2/files/%252e%252e/x");
}

#[test]
fn leaves_a_header_out_when_its_value_is_null() {
    let s =
        spec(vec![json!({ "name": "read", "options": [{ "name": "trace", "api_name": "X-Trace", "in": "header" }] })]);
    let (_, host) = run(&s, call("read", json!({ "trace": null })), vec![json_response(json!({}))]);
    assert_eq!(host.sent[0].header("X-Trace"), None);
}

#[test]
fn encodes_form_and_whole_bodies() {
    let form = spec(vec![
        json!({ "name": "f", "method": "POST", "effect": "read", "body": "form", "options": [{ "name": "meta", "in": "body" }] }),
    ]);
    let (_, host) = run(&form, call("f", json!({ "meta": { "a": 1, "b": [2] } })), vec![json_response(json!({}))]);
    assert_eq!(host.sent[0].header("Content-Type"), Some("application/x-www-form-urlencoded"));
    let body = format!("?{}", host.sent[0].body.as_deref().unwrap());
    assert_eq!(param(&body, "meta[b][0]").as_deref(), Some("2"));
    let root = spec(vec![
        json!({ "name": "r", "method": "POST", "effect": "read", "options": [{ "name": "tags", "in": "body_root" }] }),
    ]);
    let (_, host) = run(&root, call("r", json!({ "tags": [{ "a": 1 }] })), vec![json_response(json!({}))]);
    assert_eq!(host.body(0), json!([{ "a": 1 }]));
    let csv = spec(vec![
        json!({ "name": "c", "method": "POST", "effect": "read", "body": "text/csv", "options": [{ "name": "csv", "in": "body" }] }),
    ]);
    let (_, host) = run(&csv, call("c", json!({ "csv": "id,name" })), vec![json_response(json!({}))]);
    assert_eq!(host.sent[0].body.as_deref(), Some("id,name"));
}

#[test]
fn keeps_the_path_of_the_escape_hatch_below_the_base_path_of_its_host() {
    let raw = spec(vec![json!({ "name": "request", "raw": true })]);
    for path in ["/%2e%2e/x", "/a/%2E%2e/x", "/%2e/x", "/a\\..\\x", "/x?a=1", "/x#a"] {
        let (error, host) =
            fail(&raw, call("request", json!({ "method": "GET", "path": path, "host": "api" })), vec![]);
        assert!(error.message.contains("relative to its host"), "{path}: {error}");
        assert!(host.sent.is_empty());
    }
}

#[test]
fn sends_nothing_for_a_parameter_without_a_value() {
    let s = spec(vec![json!({ "name": "p", "options": [{ "name": "a", "in": "query" }] })]);
    let mut description = call("p", json!({ "a": null }));
    description.bindings =
        vec![dashql_core_runtime::clfn::spec::ClientFunctionCallBinding { pointer: "/a".into(), param: "x".into() }];
    let (error, host) = fail(&s, description.clone(), vec![]);
    assert!(error.message.contains(":x has no value"));
    assert!(host.sent.is_empty());
    let explained = explain_client_function_call(&s, &description, &ClientFunctionVariables::new()).unwrap_err();
    assert!(explained.message.contains(":x has no value"));
}

#[test]
fn sends_writes_like_any_other_call() {
    let s = spec(vec![
        json!({ "name": "w", "method": "POST", "options": [{ "name": "label", "in": "body" }], "columns": [{ "name": "id", "type": "VARCHAR" }] }),
        json!({ "name": "d", "method": "DELETE", "path": "/items/{id}", "options": [{ "name": "id", "in": "path" }] }),
        json!({ "name": "r", "raw": true }),
    ]);
    let write =
        |name: &str, options: Value| ClientFunctionCallDescription { effect: "write".into(), ..call(name, options) };
    let (created, host) = run(&s, write("w", json!({ "label": "x" })), vec![status(201, json!({ "id": "a1" }))]);
    assert_eq!(host.sent[0].method, "POST");
    assert_eq!(host.body(0), json!({ "label": "x" }));
    assert_eq!((text(&created, 0, "id").as_deref(), status_of(&created, 0)), (Some("a1"), Cell::Int32(201)));
    // No body is one row with only the standard columns
    let (removed, host) = run(&s, write("d", json!({ "id": 7 })), vec![HttpResponse::new(204, "")]);
    assert_eq!((host.sent[0].method.as_str(), host.url(0)), ("DELETE", format!("{BASE}/v2/items/7").as_str()));
    assert_eq!((removed.rows.len(), status_of(&removed, 0)), (1, Cell::Int32(204)));
    let (_, host) = run(
        &s,
        write("r", json!({ "method": "PATCH", "path": "/x", "host": "api" })),
        vec![json_response(json!({ "ok": true }))],
    );
    assert_eq!(host.sent[0].method, "PATCH");
}

#[test]
fn keeps_the_escape_hatch_on_its_hosts() {
    let raw = spec(vec![json!({ "name": "request", "raw": true })]);
    let (result, host) = run(
        &raw,
        call("request", json!({ "method": "get", "path": "/new", "host": "api", "someParam": 1 })),
        vec![json_response(json!({ "a": 1 }))],
    );
    assert_eq!(host.url(0), format!("{BASE}/v2/new?someParam=1"));
    assert_eq!(text(&result, 0, "_raw").as_deref(), Some("{\"a\":1}"));
    for path in ["https://evil.example.com/x", "//evil.example.com/x", "/a/../b", "x"] {
        let (error, _) = fail(&raw, call("request", json!({ "method": "GET", "path": path, "host": "api" })), vec![]);
        assert!(error.message.contains("relative to its host"), "{path}: {error}");
    }
    let (error, _) = fail(&raw, call("request", json!({ "method": "GET", "path": "/x", "host": "other" })), vec![]);
    assert!(error.message.contains("no host other"), "{error}");
}

// The paging

fn token_paging() -> Rc<ClientFunctionSpec> {
    spec(vec![json!({
        "name": "list", "rows": "/items",
        "options": [{ "name": "token", "api_name": "pageToken", "in": "query" }, { "name": "size", "in": "query" }],
        "columns": [{ "name": "id", "type": "BIGINT" }],
        "paging": { "kind": "token", "from": { "body": "/next" }, "option": "token" },
    })])
}

fn ids(result: &ClientFunctionResult) -> Vec<Cell> {
    (0..result.rows.len()).map(|i| result.cell(i, "id").unwrap().clone()).collect()
}

#[test]
fn returns_one_page_with_the_value_for_the_next_one_in_meta() {
    let (result, host) = run(
        &token_paging(),
        call("list", json!({ "size": 2 })),
        vec![json_response(json!({ "items": [{ "id": 1 }, { "id": 2 }], "next": "abc", "total": 9 }))],
    );
    assert_eq!(host.sent.len(), 1);
    assert_eq!(ids(&result), [Cell::Int64(1), Cell::Int64(2)]);
    assert_eq!(json_cell(&result, 0, "_meta"), json!({ "next": "abc", "total": 9 }));
}

#[test]
fn applies_next_to_the_option_of_the_function() {
    let (result, host) = run(
        &token_paging(),
        call("list", json!({ "size": 2, "_next": "abc" })),
        vec![json_response(json!({ "items": [{ "id": 3 }] }))],
    );
    assert_eq!(param(host.url(0), "pageToken").as_deref(), Some("abc"));
    assert_eq!(param(host.url(0), "size").as_deref(), Some("2"));
    assert_eq!(param(host.url(0), "_next"), None);
    assert_eq!(ids(&result), [Cell::Int64(3)]);
}

#[test]
fn concatenates_up_to_pages_and_next_continues_after_them() {
    let (result, host) = run(
        &token_paging(),
        call("list", json!({ "_pages": 2 })),
        vec![
            json_response(json!({ "items": [{ "id": 1 }], "next": "a" })),
            json_response(json!({ "items": [{ "id": 2 }], "next": "b" })),
        ],
    );
    assert_eq!(host.sent.len(), 2);
    assert_eq!(ids(&result), [Cell::Int64(1), Cell::Int64(2)]);
    assert_eq!(param(host.url(1), "pageToken").as_deref(), Some("a"));
    assert_eq!(result.column_names(), ["id", "_status", "_meta", "_raw"]);
}

#[test]
fn stops_when_the_list_ends_and_fails_as_a_whole() {
    let (_, host) = run(
        &token_paging(),
        call("list", json!({ "_pages": 10 })),
        vec![
            json_response(json!({ "items": [{ "id": 1 }], "next": "a" })),
            json_response(json!({ "items": [{ "id": 2 }] })),
        ],
    );
    assert_eq!(host.sent.len(), 2);
    let (error, _) = fail(
        &token_paging(),
        call("list", json!({ "_pages": 2 })),
        vec![json_response(json!({ "items": [{ "id": 1 }], "next": "a" })), status(500, json!({ "message": "boom" }))],
    );
    assert_eq!(error.message, "boom");
}

#[test]
fn fails_on_a_token_that_comes_back_unchanged() {
    let page = || json_response(json!({ "items": [{ "id": 1 }], "next": "a" }));
    let (error, _) = fail(&token_paging(), call("list", json!({ "_pages": 5 })), vec![page(), page()]);
    assert!(error.message.contains("same next value"));
    let (error, _) = fail(&token_paging(), call("list", json!({ "_next": "a" })), vec![page()]);
    assert!(error.message.contains("same next value"));
}

#[test]
fn returns_no_rows_for_an_empty_page_of_a_paged_function() {
    let (result, _) =
        run(&token_paging(), call("list", json!({})), vec![json_response(json!({ "items": [], "next": "a" }))]);
    assert!(result.rows.is_empty());
    let (last, _) = run(&token_paging(), call("list", json!({})), vec![json_response(json!({ "items": [] }))]);
    assert!(last.rows.is_empty());
}

#[test]
fn reads_a_value_by_the_rel_of_a_link_header_and_fails_on_a_source_it_does_not_know() {
    let list =
        |from: Value| spec(vec![json!({ "name": "list", "rows": "", "paging": { "kind": "url", "from": from } })]);
    let links = json_response(json!([{ "a": 1 }])).with_header("Link", "</a>; rel=\"first\", </b>; rel=\"last\"");
    let (_, host) = run(
        &list(json!({ "link": "last" })),
        call("list", json!({ "_pages": 2 })),
        vec![links, json_response(json!([]))],
    );
    assert_eq!(host.url(1), format!("{BASE}/b"));
    let (error, _) =
        fail(&list(json!({ "nope": "x" })), call("list", json!({})), vec![json_response(json!([{ "a": 1 }]))]);
    assert!(error.message.contains("unknown source"), "{error}");
}

#[test]
fn follows_a_next_url_with_get_and_no_body() {
    let s = spec(vec![json!({
        "name": "search", "method": "POST", "effect": "read", "rows": "",
        "options": [{ "name": "q", "in": "body" }, { "name": "trace", "api_name": "X-Trace", "in": "header" }],
        "paging": { "kind": "url", "from": { "link": "next" } },
    })]);
    let first = json_response(json!([{ "a": 1 }]))
        .with_header("Link", "</results/1?page=0>; rel=\"first\", </results/1?page=1>; rel=\"next\"");
    let (result, host) = run(
        &s,
        call("search", json!({ "q": "x", "trace": "t", "_pages": 2 })),
        vec![first, json_response(json!([{ "a": 2 }]))],
    );
    assert_eq!(host.sent[0].method, "POST");
    assert_eq!(host.url(1), format!("{BASE}/results/1?page=1"));
    assert_eq!(host.sent[1].method, "GET");
    assert_eq!(host.sent[1].body, None);
    assert_eq!(host.sent[1].header("X-Trace"), Some("t"));
    assert_eq!(host.sent[1].header("Authorization"), Some("Bearer token"));
    assert_eq!(host.sent[1].header("Content-Type"), None);
    assert_eq!(result.rows.len(), 2);
}

#[test]
fn never_sends_the_token_to_another_origin() {
    let s = spec(vec![
        json!({ "name": "feed", "rows": "/items", "options": [{ "name": "required", "api_name": "r", "in": "path" }], "path": "/{r}", "paging": { "kind": "url", "from": { "body": "/next" } } }),
    ]);
    let (error, host) = fail(&s, call("feed", json!({ "_next": "https://evil.example.com/x" })), vec![]);
    assert!(error.message.contains("another origin"), "{error}");
    assert!(host.sent.is_empty());
    let (error, host) = fail(
        &s,
        call("feed", json!({ "required": "a", "_pages": 2 })),
        vec![json_response(json!({ "items": [{}], "next": "https://evil.example.com/x" }))],
    );
    assert!(error.message.contains("another origin"), "{error}");
    assert_eq!(host.sent.len(), 1);
}

#[test]
fn takes_a_cursor_from_the_last_row_and_ends_with_has_more() {
    let s = spec(vec![json!({
        "name": "charges", "rows": "/data", "options": [{ "name": "starting_after", "in": "query" }],
        "paging": { "kind": "token", "from": { "last_row": "/id" }, "option": "starting_after", "end": { "has_more": "/has_more" } },
    })]);
    let (result, host) = run(
        &s,
        call("charges", json!({ "_pages": 5 })),
        vec![
            json_response(json!({ "data": [{ "id": "a" }, { "id": "b" }], "has_more": true })),
            json_response(json!({ "data": [{ "id": "c" }], "has_more": false })),
        ],
    );
    assert_eq!(param(host.url(1), "starting_after").as_deref(), Some("b"));
    assert_eq!(host.sent.len(), 2);
    assert_eq!(result.rows.len(), 3);
}

#[test]
fn advances_offsets_by_the_rows_that_arrived() {
    let with_paging = |paging: Value| {
        spec(vec![
            json!({ "name": "o", "rows": "/items", "options": [{ "name": "offset", "in": "query" }, { "name": "limit", "in": "query" }], "paging": paging }),
        ])
    };
    let paging = json!({ "kind": "offset", "option": "offset", "size": "limit", "start": 0 });
    let pages = vec![json_response(json!({ "items": [{}, {}] })), json_response(json!({ "items": [] }))];
    let (_, host) =
        run(&with_paging(paging.clone()), call("o", json!({ "limit": 100, "offset": 10, "_pages": 2 })), pages);
    assert_eq!(param(host.url(1), "offset").as_deref(), Some("12"));
    let (_, short) = run(
        &with_paging(merge(paging.clone(), json!({ "end": "short_page" }))),
        call("o", json!({ "limit": 100, "_pages": 2 })),
        vec![json_response(json!({ "items": [{}, {}] }))],
    );
    assert_eq!(short.sent.len(), 1);
    let (_, total) = run(
        &with_paging(merge(paging.clone(), json!({ "end": { "total": "/totalSize" } }))),
        call("o", json!({ "offset": 8, "limit": 2, "_pages": 2 })),
        vec![json_response(json!({ "items": [{}, {}], "totalSize": 10 }))],
    );
    assert_eq!(total.sent.len(), 1);
    let (_, host) =
        run(&with_paging(paging), call("o", json!({ "_next": "12" })), vec![json_response(json!({ "items": [{}] }))]);
    assert_eq!(param(host.url(0), "offset").as_deref(), Some("12"));
}

#[test]
fn counts_page_numbers() {
    let s = spec(vec![
        json!({ "name": "p", "rows": "", "options": [{ "name": "page", "in": "query" }], "paging": { "kind": "page", "option": "page", "start": 1 } }),
    ]);
    let (result, host) = run(
        &s,
        call("p", json!({ "_pages": 9 })),
        vec![json_response(json!([{}])), json_response(json!([{}])), json_response(json!([]))],
    );
    assert_eq!(host.sent.len(), 3);
    assert_eq!(param(host.url(2), "page").as_deref(), Some("3"));
    assert_eq!(result.rows.len(), 2);
}

#[test]
fn rejects_paging_a_function_that_does_not_page() {
    let (error, _) = fail(&spec(vec![json!({ "name": "x" })]), call("x", json!({ "_next": "a" })), vec![]);
    assert!(error.message.contains("doesn't page"));
}

// The results

fn typed_columns() -> Value {
    json!([
        { "name": "api_name", "api_name": "apiName", "type": "VARCHAR" },
        { "name": "count", "type": "INTEGER" },
        { "name": "size", "type": "BIGINT" },
        { "name": "ratio", "type": "DOUBLE" },
        { "name": "active", "type": "BOOLEAN" },
        { "name": "created", "type": "TIMESTAMPTZ" },
        { "name": "day", "type": "DATE" },
        { "name": "status", "type": "JSON" },
    ])
}

#[test]
fn keeps_what_a_column_can_not_hold_in_raw() {
    let s = spec(vec![json!({ "name": "one", "columns": typed_columns() })]);
    let (result, _) = run(
        &s,
        call("one", json!({})),
        vec![json_response(
            json!({ "apiName": "a", "count": "many", "size": 5, "ratio": 0.5, "active": true, "status": { "queryId": "q" }, "extra": 1 }),
        )],
    );
    assert_eq!(text(&result, 0, "api_name").as_deref(), Some("a"));
    assert_eq!(result.cell(0, "count"), Some(&Cell::Null));
    assert_eq!(text(&result, 0, "status").as_deref(), Some("{\"queryId\":\"q\"}"));
    assert_eq!(json_cell(&result, 0, "_raw"), json!({ "count": "many", "extra": 1 }));
    assert_eq!(status_of(&result, 0), Cell::Int32(200));
}

#[test]
fn returns_one_row_without_a_body() {
    let s = spec(vec![json!({ "name": "n", "columns": typed_columns() })]);
    let (result, _) = run(&s, call("n", json!({})), vec![HttpResponse::new(204, "")]);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(status_of(&result, 0), Cell::Int32(204));
    assert_eq!(result.cell(0, "api_name"), Some(&Cell::Null));
}

#[test]
fn reports_errors_from_the_pointers_of_the_spec() {
    let with_errors = |errors: Value| spec(vec![json!({ "name": "e", "errors": errors })]);
    let (failure, _) = fail(
        &with_errors(json!(null)),
        call("e", json!({})),
        vec![status(403, json!({ "error": { "message": "nope" } }))],
    );
    assert_eq!((failure.message.as_str(), failure.status), ("nope", Some(403)));
    let (failure, _) = fail(&with_errors(json!(null)), call("e", json!({})), vec![HttpResponse::new(500, "")]);
    assert!(failure.message.contains("status 500"), "{failure}");
    let nested = status(400, json!([{ "message": json!({ "message": "inner" }).to_string() }]));
    let (failure, _) = fail(
        &with_errors(json!({ "message": ["/0/message"], "message_is_json": true })),
        call("e", json!({})),
        vec![nested],
    );
    assert_eq!(failure.message, "inner");
    let (failure, _) = fail(
        &with_errors(json!({ "error_if": "/errors", "message": ["/errors/0"] })),
        call("e", json!({})),
        vec![json_response(json!({ "errors": ["bad"] }))],
    );
    assert_eq!(failure.message, "bad");
    let empty = spec(vec![json!({ "name": "e", "rows": "/items", "errors": { "empty_on": [404] } })]);
    let (result, _) = run(&empty, call("e", json!({})), vec![status(404, json!({}))]);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(status_of(&result, 0), Cell::Int32(404));
}

#[test]
fn keeps_a_timestamp_or_a_date_that_the_column_cant_hold_in_raw() {
    let s = spec(vec![
        json!({ "name": "one", "columns": [{ "name": "at", "type": "TIMESTAMPTZ" }, { "name": "day", "type": "DATE" }] }),
    ]);
    let read =
        |value: Value| run(&s, call("one", json!({})), vec![json_response(json!({ "at": value, "day": value }))]).0;
    let instant = 1_710_147_682_000_i64; // 2024-03-11T09:01:22Z
    let midnight = 19_793; // 2024-03-11
    for text_value in ["2024-03-11T09:01:22Z", "2024-03-11T09:01:22.000+0000", "2024-03-11T09:01:22+00:00"] {
        let result = read(json!(text_value));
        assert_eq!(result.cell(0, "at"), Some(&Cell::TimestampMs(instant)), "{text_value}");
        assert_eq!(result.cell(0, "day"), Some(&Cell::Date(midnight)));
        assert_eq!(result.cell(0, "_raw"), Some(&Cell::Null));
    }
    // A day alone fits the date column and not the timestamp column
    let day_only = read(json!("2024-03-11"));
    assert_eq!(day_only.cell(0, "at"), Some(&Cell::Null));
    assert_eq!(day_only.cell(0, "day"), Some(&Cell::Date(midnight)));
    assert_eq!(json_cell(&day_only, 0, "_raw"), json!({ "at": "2024-03-11" }));
    // The day that a value says, wherever its zone puts it in UTC
    assert_eq!(read(json!("2024-03-11T23:30:00-05:00")).cell(0, "day"), Some(&Cell::Date(midnight)));
    for value in [json!("Mar 11 2024"), json!("2024-13-45"), json!(1_710_147_682_000_i64)] {
        let result = read(value.clone());
        assert_eq!(result.cell(0, "at"), Some(&Cell::Null));
        assert_eq!(result.cell(0, "day"), Some(&Cell::Null));
        assert_eq!(json_cell(&result, 0, "_raw"), json!({ "at": value, "day": value }));
    }
    // The batch holds the instant and the day
    let batch = read(json!("2024-03-11T09:01:22Z")).to_record_batch().unwrap();
    assert_eq!(batch.column(0).as_primitive::<TimestampMillisecondType>().value(0), instant);
    assert_eq!(batch.column(1).as_primitive::<Date32Type>().value(0), midnight);
}

#[test]
fn produces_arrow_batches() {
    let s = spec(vec![json!({ "name": "one", "columns": typed_columns() })]);
    let body = json!({ "apiName": "a", "count": 3, "size": "9007199254740993", "ratio": 0.5, "active": true, "created": "2026-01-02T03:04:05Z", "day": "2026-01-02", "status": { "a": 1 } });
    let (result, _) = run(&s, call("one", json!({})), vec![json_response(body)]);
    let batch = result.to_record_batch().unwrap();
    assert_eq!(batch.num_rows(), 1);
    let column = |name: &str| batch.column_by_name(name).unwrap().clone();
    assert_eq!(column("api_name").as_string::<i32>().value(0), "a");
    assert_eq!(column("count").as_primitive::<Int32Type>().value(0), 3);
    assert_eq!(column("size").as_primitive::<Int64Type>().value(0), 9_007_199_254_740_993);
    assert!(column("active").as_boolean().value(0));
    assert_eq!(column("created").as_primitive::<TimestampMillisecondType>().value(0), 1_767_323_045_000);
    assert_eq!(column("_status").as_primitive::<Int32Type>().value(0), 200);
    assert!(batch.column_by_name("_next").is_none());
}

#[test]
fn hands_the_rows_over_page_by_page() {
    let variables = ClientFunctionVariables::from([("version".to_string(), "2".to_string())]);
    let (mut run, step) =
        ClientFunctionCallRun::start(token_paging(), &call("list", json!({ "_pages": 3 })), variables, 0.0).unwrap();
    assert!(matches!(step, CallStep::Send(_)));
    let step =
        run.on_response(json_response(json!({ "items": [{ "id": 1 }, { "id": 2 }], "next": "a" })), 0.0).unwrap();
    assert!(matches!(step, CallStep::Send(_)));
    // The rows of a page are ready once it arrived, the run keeps none
    let first = run.take_rows().unwrap();
    assert_eq!(ids(&first), vec![Cell::Int64(1), Cell::Int64(2)]);
    assert!(run.take_rows().is_none());
    let step = run.on_response(json_response(json!({ "items": [] , "next": "b" })), 0.0).unwrap();
    assert!(matches!(step, CallStep::Send(_)));
    assert!(run.take_rows().is_none());
    let step = run.on_response(json_response(json!({ "items": [{ "id": 3 }], "next": "c" })), 0.0).unwrap();
    assert_eq!(step, CallStep::Done);
    assert_eq!(ids(&run.take_rows().unwrap()), vec![Cell::Int64(3)]);
}

// The pending results

fn slow(pending: Value) -> Rc<ClientFunctionSpec> {
    spec(vec![
        json!({ "name": "slow", "rows": "", "columns": [{ "name": "id", "type": "BIGINT" }], "pending": pending, "options": [{ "name": "required", "in": "query" }] }),
    ])
}

fn location() -> Value {
    json!({ "status": 202, "poll": { "header": "Location" } })
}

fn accepted() -> HttpResponse {
    HttpResponse::new(202, "{}").with_header("Location", "/results/1")
}

#[test]
fn reports_a_call_that_is_not_finished_as_pending() {
    let (result, host) = run(&slow(location()), call("slow", json!({ "required": 1 })), vec![accepted()]);
    assert_eq!(host.sent.len(), 1);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(status_of(&result, 0), Cell::Int32(202));
    assert_eq!(text(&result, 0, "_poll").as_deref(), Some("/results/1"));
}

#[test]
fn polls_with_poll_with_get_and_without_other_options() {
    let (result, host) = run(
        &slow(location()),
        call("slow", json!({ "_poll": "/results/1" })),
        vec![json_response(json!([{ "id": 1 }]))],
    );
    assert_eq!(host.url(0), format!("{BASE}/results/1"));
    assert_eq!(host.sent[0].method, "GET");
    assert_eq!(text(&result, 0, "_poll"), None);
    assert_eq!(result.cell(0, "id"), Some(&Cell::Int64(1)));
}

#[test]
fn waits_up_to_wait_and_honors_retry_after() {
    let (result, host) = run(
        &slow(location()),
        call("slow", json!({ "required": 1, "_wait": 60 })),
        vec![accepted().with_header("Retry-After", "5"), accepted(), json_response(json!([{ "id": 1 }]))],
    );
    assert_eq!(host.sleeps, [5000.0, 2000.0]);
    assert_eq!(host.url(1), format!("{BASE}/results/1"));
    assert_eq!(host.sent[1].method, "GET");
    assert_eq!(text(&result, 0, "_poll"), None);
}

#[test]
fn returns_the_pending_row_when_the_time_runs_out() {
    let (result, host) = run(
        &slow(location()),
        call("slow", json!({ "required": 1, "_wait": 3 })),
        vec![accepted(), accepted(), accepted()],
    );
    assert_eq!(status_of(&result, 0), Cell::Int32(202));
    assert_eq!(host.sleeps, [1000.0, 2000.0]);
}

#[test]
fn repeats_the_request_for_poll_rule_same() {
    let repeat = slow(json!({ "status": 202, "poll": { "repeat": true } }));
    let (_, host) = run(
        &repeat,
        call("slow", json!({ "required": 1, "_wait": 5 })),
        vec![HttpResponse::new(202, "{}"), json_response(json!([{ "id": 1 }]))],
    );
    assert_eq!(host.sent.len(), 2);
    assert_eq!(host.url(1), host.url(0));
    let (pending, _) = run(&repeat, call("slow", json!({ "required": 1 })), vec![HttpResponse::new(202, "{}")]);
    assert_eq!(text(&pending, 0, "_poll").as_deref(), Some("same"));
}

#[test]
fn fails_without_the_header_it_polls_and_on_another_origin() {
    let (error, _) =
        fail(&slow(location()), call("slow", json!({ "required": 1 })), vec![HttpResponse::new(202, "{}")]);
    assert!(error.message.contains("without a Location header"), "{error}");
    let (error, _) = fail(&slow(location()), call("slow", json!({ "_poll": "https://evil.example.com/x" })), vec![]);
    assert!(error.message.contains("another origin"), "{error}");
}

#[test]
fn treats_the_status_as_success_without_a_pending_rule() {
    let (result, _) =
        run(&spec(vec![json!({ "name": "done" })]), call("done", json!({})), vec![HttpResponse::new(202, "{\"a\":1}")]);
    assert!(result.column("_poll").is_none());
    assert_eq!(status_of(&result, 0), Cell::Int32(202));
}

#[test]
fn stops_polling_when_the_statement_is_canceled() {
    // Canceling drops the run: while it waits, it sends nothing on its own and takes no response
    let variables = ClientFunctionVariables::from([("version".to_string(), "2".to_string())]);
    let (mut run, step) = ClientFunctionCallRun::start(
        slow(location()),
        &call("slow", json!({ "required": 1, "_wait": 60 })),
        variables,
        0.0,
    )
    .unwrap();
    assert!(matches!(step, CallStep::Send(_)));
    assert!(matches!(run.on_response(accepted(), 0.0).unwrap(), CallStep::Sleep { ms } if ms == 1000.0));
    assert!(run.on_response(accepted(), 0.0).is_err());
}

#[test]
fn has_a_poll_column_only_with_a_pending_rule() {
    let (without, _) = run(&spec(vec![json!({ "name": "x" })]), call("x", json!({})), vec![json_response(json!({}))]);
    assert_eq!(without.column_names(), ["_status", "_meta", "_raw"]);
    let (error, _) = fail(&spec(vec![json!({ "name": "x" })]), call("x", json!({ "_poll": "a" })), vec![]);
    assert!(error.message.contains("no option _poll"));
}

// EXPLAIN

fn explain_fn() -> Value {
    json!({
        "name": "create", "method": "POST", "path": "/projects/{project}",
        "options": [
            { "name": "project", "in": "path" },
            { "name": "page_size", "api_name": "pageSize", "in": "query" },
            { "name": "signing_key", "api_name": "signingKey", "in": "body" },
            { "name": "token", "api_name": "X-Token", "in": "header" },
        ],
    })
}

fn version() -> ClientFunctionVariables {
    ClientFunctionVariables::from([("version".to_string(), "2".to_string())])
}

#[test]
fn explain_prints_the_request_with_api_names_and_sends_nothing_even_for_a_write() {
    let description = call("create", json!({ "project": "a", "page_size": 5, "signing_key": "key", "token": "abc" }));
    let result = explain_client_function_call(&spec(vec![explain_fn()]), &description, &version()).unwrap();
    assert_eq!(text(&result, 0, "method").as_deref(), Some("POST"));
    assert_eq!(text(&result, 0, "host").as_deref(), Some("api"));
    assert_eq!(text(&result, 0, "path").as_deref(), Some("/v2/projects/a"));
    assert_eq!(text(&result, 0, "query").as_deref(), Some("pageSize=5"));
    assert_eq!(json_cell(&result, 0, "body"), json!({ "signingKey": "key" }));
    assert_eq!(json_cell(&result, 0, "headers")["X-Token"], json!("abc"));
}

#[test]
fn explain_works_without_a_binding() {
    let result = explain_client_function_call(
        &spec(vec![explain_fn()]),
        &call("create", json!({ "project": "a" })),
        &ClientFunctionVariables::new(),
    )
    .unwrap();
    assert_eq!(text(&result, 0, "path").as_deref(), Some("/v{version}/projects/a"));
}

#[test]
fn explain_prints_the_first_request_that_a_run_sends() {
    let feed = json!({ "name": "feed", "options": [{ "name": "trace", "api_name": "X-Trace", "in": "header" }, { "name": "offset", "in": "query" }], "rows": "/items", "paging": { "kind": "offset", "option": "offset" } });
    let follow =
        merge(feed.clone(), json!({ "name": "follow", "paging": { "kind": "url", "from": { "body": "/next" } } }));
    for (function, options, path_text, query_text) in [
        (follow, json!({ "trace": "a", "_next": "/feed?page=2" }), "/feed?page=2", None),
        (feed, json!({ "trace": "a", "_next": "20" }), "/v2/items", Some("offset=20")),
    ] {
        let name = function["name"].as_str().unwrap().to_string();
        let s = spec(vec![function]);
        let explained = explain_client_function_call(&s, &call(&name, options.clone()), &version()).unwrap();
        assert_eq!(text(&explained, 0, "path").as_deref(), Some(path_text));
        assert_eq!(text(&explained, 0, "query").as_deref(), query_text);
        assert_eq!(json_cell(&explained, 0, "headers"), json!({ "X-Trace": "a" }));
        let (_, host) = run(&s, call(&name, options), vec![json_response(json!({ "items": [] }))]);
        let sent = host.url(0).strip_prefix(BASE).unwrap().to_string();
        assert_eq!(sent, query_text.map_or(path_text.to_string(), |q| format!("{path_text}?{q}")));
        assert_eq!(host.sent[0].header("X-Trace"), Some("a"));
    }
}

#[test]
fn explain_refuses_what_a_run_refuses() {
    let s = spec(vec![
        json!({ "name": "create", "method": "POST", "pending": { "status": 202, "poll": { "header": "Location" } } }),
    ]);
    let error =
        explain_client_function_call(&s, &call("create", json!({ "_poll": "same" })), &ClientFunctionVariables::new())
            .unwrap_err();
    assert!(error.message.contains("polls a URL"));
}

#[test]
fn explain_shows_a_followed_url_and_what_the_runtime_applies_itself() {
    let s = spec(vec![json!({ "name": "feed", "paging": { "kind": "url", "from": { "body": "/next" } } })]);
    let result = explain_client_function_call(
        &s,
        &call("feed", json!({ "_next": "/feed?page=2", "_pages": 3 })),
        &ClientFunctionVariables::new(),
    )
    .unwrap();
    assert_eq!(text(&result, 0, "method").as_deref(), Some("GET"));
    assert_eq!(text(&result, 0, "path").as_deref(), Some("/feed?page=2"));
    assert_eq!(json_cell(&result, 0, "standard_options"), json!({ "_next": "/feed?page=2", "_pages": 3 }));
}

#[test]
fn reads_specs_without_the_fields_of_the_core() {
    // A function without a pending rule of its own takes the one of the spec, null means none
    let s = spec_with(
        vec![json!({ "name": "a" }), json!({ "name": "b", "pending": null })],
        json!({ "pending": { "status": 202, "poll": { "header": "Location" } } }),
    );
    assert!(s.pending_of(s.function("a").unwrap()).is_some());
    assert!(s.pending_of(s.function("b").unwrap()).is_none());
    assert!(s.function("c").unwrap_err().message.contains("t has no function c"));
}
