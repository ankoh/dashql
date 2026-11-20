//! The client functions with the generated spec of the Data 360 extension.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use dashql_core::analyzer::analyze;
use dashql_core::catalog::Catalog;
use dashql_core::completion::Completion;
use dashql_core::cursor::{ScriptCursor, ScriptView};
use dashql_core_runtime::clfn::*;
use dashql_core_runtime::connections::{ConnectionAction, ConnectionParams, ConnectionState, ConnectorType};
use dashql_core_runtime::salesforce::*;
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use serde_json::{json, Value};

const SPEC: &str = "extensions/d360-api/clfn/spec/spec.json";
/// 2026-01-01T00:00:00.000Z
const NOW: f64 = 1_767_225_600_000.0;

fn spec_text() -> String {
    std::fs::read_to_string(SPEC).expect("the spec is a test input")
}

fn spec() -> Rc<ClientFunctionSpec> {
    Rc::new(ClientFunctionSpec::from_json(&spec_text()).unwrap())
}

/// The descriptions of the calls of a text on a catalog
fn describe(catalog: &Catalog, text: &str) -> Vec<Value> {
    let entry_id = catalog.allocate_entry_id();
    let parsed = Arc::new(parse(Arc::new(scan(text, 0, entry_id))));
    let analyzed = analyze(parsed, catalog).expect("the analysis runs");
    analyzed
        .client_function_calls
        .iter()
        .filter_map(|call| analyzed.describe_client_function_call(call.ast_statement_id))
        .collect()
}

// The specs

#[test]
fn loads_the_generated_spec_of_an_extension() {
    let spec = spec();
    assert_eq!(spec.namespace, "d360");
    assert!(spec.functions.len() > 500);
}

#[test]
fn leaves_out_the_prose_of_the_reference() {
    let value: Value = serde_json::from_str(&spec_text()).unwrap();
    for function in value["functions"].as_array().unwrap() {
        assert!(function.get("notes").is_none(), "{}", function["name"]);
    }
}

// The examples

/// A description as the runtime gets it, with values in place of its parameters
fn with_values(description: Value) -> ClientFunctionCallDescription {
    let mut description = ClientFunctionCallDescription::from_value(description).unwrap();
    let mut options = Value::Object(description.options.clone());
    for binding in std::mem::take(&mut description.bindings) {
        *options.pointer_mut(&binding.pointer).expect("the pointer of a binding") =
            json!(format!(":{}", binding.param));
    }
    description.options = options.as_object().cloned().unwrap();
    description
}

#[test]
fn the_examples_build_a_request_of_their_function() {
    let spec = spec();
    let mut catalog = Catalog::new();
    catalog.register_client_functions(&spec_text()).unwrap();
    let functions: Vec<_> = spec.functions.iter().filter(|f| !f.raw).collect();
    assert!(functions.len() > 500);
    let variables = BTreeMap::from([("api_version".to_string(), "68.0".to_string())]);
    for function in functions {
        let example = function.example.as_deref().unwrap();
        let described = describe(&catalog, example);
        assert_eq!(described.len(), 1, "{example}");
        let description = with_values(described.into_iter().next().unwrap());
        assert_eq!(description.function, function.name, "{example}");
        let result =
            explain_client_function_call(&spec, &description, &variables).unwrap_or_else(|e| panic!("{example}: {e}"));
        let field = |name: &str| result.cell(0, name).and_then(Cell::as_str).map(str::to_string);
        assert_eq!(field("method"), function.method.clone(), "{example}");
        assert_eq!(field("host"), function.host.clone(), "{example}");
        // The placeholders of the path and of the base path of its host are filled
        assert!(!field("path").unwrap().contains('{'), "{example}");
    }
}

// The client functions of a connection

fn connection(connector: ConnectorType) -> ConnectionState {
    ConnectionState::from_params("c", ConnectionParams::default_for(connector), NOW)
}

/// The calls in the namespace of the Data 360 client functions
fn calls(state: &ConnectionState) -> usize {
    describe(&state.catalog().borrow(), "call d360.segment_list ();").len()
}

/// Register the client functions of a connection with the spec
fn sync(registrations: &mut ClientFunctionRegistrations, state: &ConnectionState) -> Vec<ClientFunctionRegistryEffect> {
    let effects = registrations.ensure(state);
    let [ClientFunctionRegistryEffect::LoadSpec { extension, ticket, .. }] = effects.as_slice() else {
        panic!("{effects:?}")
    };
    assert_eq!(*extension, "d360-api");
    registrations.spec_loaded(Some(state), *ticket, Ok(&spec_text())).unwrap()
}

#[test]
fn come_with_a_salesforce_connection_before_any_login() {
    let state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    assert_eq!(calls(&state), 0);
    assert_eq!(sync(&mut registrations, &state), [ClientFunctionRegistryEffect::Updated { connection_id: "c".into() }]);
    assert_eq!(calls(&state), 1);
    assert_eq!(registrations.spec(&state).unwrap().namespace, "d360");

    let catalog = state.catalog().borrow();
    let text = "call d360.segment_pub";
    let scanned = Arc::new(scan(text, 0, catalog.allocate_entry_id()));
    let parsed = Arc::new(parse(scanned.clone()));
    let analyzed = Arc::new(analyze(parsed.clone(), &catalog).unwrap());
    let view =
        ScriptView { scanned: Some(&scanned), parsed: Some(&parsed), analyzed: Some(&analyzed), catalog: &catalog };
    let cursor = ScriptCursor::place(view, text.len());
    let completion = Completion::compute(&cursor, 10);
    assert_eq!(&*completion.top_candidates[0].completion_text, "segment_publish");
}

#[test]
fn are_registered_once() {
    let state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    sync(&mut registrations, &state);
    assert!(registrations.ensure(&state).is_empty());
    // While the spec loads, the registration waits for it
    let other = connection(ConnectorType::SalesforceDataCloud);
    let mut loading = ClientFunctionRegistrations::default();
    assert_eq!(loading.ensure(&other).len(), 1);
    assert!(loading.ensure(&other).is_empty());
}

#[test]
fn are_tried_again_if_their_spec_failed_to_load() {
    let state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    let effects = registrations.ensure(&state);
    let [ClientFunctionRegistryEffect::LoadSpec { ticket, .. }] = effects.as_slice() else { panic!() };
    assert!(registrations.spec_loaded(Some(&state), *ticket, Err("chunk failed".into())).is_err());
    assert_eq!(calls(&state), 0);
    // A spec that the core rejects stays unregistered as well
    let effects = registrations.ensure(&state);
    let [ClientFunctionRegistryEffect::LoadSpec { ticket, .. }] = effects.as_slice() else { panic!() };
    assert!(registrations.spec_loaded(Some(&state), *ticket, Ok("{\"format\": 99}")).is_err());
    sync(&mut registrations, &state);
    assert_eq!(calls(&state), 1);
}

#[test]
fn survive_a_reset_of_the_connection() {
    let mut state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    sync(&mut registrations, &state);
    state.apply(ConnectionAction::Reset, NOW).unwrap();
    assert_eq!(calls(&state), 1);
    assert!(registrations.ensure(&state).is_empty());
}

#[test]
fn are_dropped_when_the_connection_switches_to_a_connector_without_them() {
    let mut state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    sync(&mut registrations, &state);
    state.apply(ConnectionAction::SwitchConnectorType(ConnectorType::Trino), NOW).unwrap();
    assert_eq!(state.connector_type(), ConnectorType::Trino);
    assert_eq!(registrations.ensure(&state), [ClientFunctionRegistryEffect::Updated { connection_id: "c".into() }]);
    assert_eq!(calls(&state), 0);
}

#[test]
fn do_not_reach_a_catalog_that_is_gone_by_the_time_the_spec_loaded() {
    let state = connection(ConnectorType::SalesforceDataCloud);
    let mut registrations = ClientFunctionRegistrations::default();
    let effects = registrations.ensure(&state);
    let [ClientFunctionRegistryEffect::LoadSpec { ticket, .. }] = effects.as_slice() else { panic!() };
    assert!(registrations.spec_loaded(None, *ticket, Ok(&spec_text())).unwrap().is_empty());
    // A new connection with the same id has a catalog of its own
    let replaced = connection(ConnectorType::SalesforceDataCloud);
    assert!(registrations.spec_loaded(Some(&replaced), *ticket, Ok(&spec_text())).unwrap().is_empty());
    assert_eq!(calls(&replaced), 0);
}

#[test]
fn are_not_on_other_connectors() {
    for connector in [ConnectorType::Hyper, ConnectorType::Trino, ConnectorType::Dbcom] {
        let state = connection(connector);
        let mut registrations = ClientFunctionRegistrations::default();
        assert!(registrations.ensure(&state).is_empty());
        assert_eq!(calls(&state), 0);
    }
}

// A call of a connection

fn tokens() -> SalesforceTokens {
    SalesforceTokens {
        core: SalesforceCoreAccessToken {
            access_token: "core-token".into(),
            instance_url: Some("https://org.my.salesforce.com".into()),
            ..Default::default()
        },
        data_cloud: SalesforceDataCloudAccessToken {
            instance_url: "https://tenant.c360a.salesforce.com/".into(),
            jwt: SalesforceDataCloudJwt { raw: "tenant-jwt".into(), ..Default::default() },
            ..Default::default()
        },
    }
}

fn d360(name: &str, options: Value, explain: bool) -> ClientFunctionCallDescription {
    ClientFunctionCallDescription {
        namespace: "d360".into(),
        function: name.into(),
        effect: "read".into(),
        explain,
        options: options.as_object().cloned().unwrap(),
        bindings: Vec::new(),
    }
}

/// Run a call of a Salesforce connection whose service answers with a body
fn execute(
    description: &ClientFunctionCallDescription,
    tokens: Option<&SalesforceTokens>,
    body: Value,
) -> Result<(ClientFunctionResult, Vec<HttpRequest>), ClientFunctionError> {
    let mut sent = Vec::new();
    let channel = tokens.map(|tokens| {
        let params = dashql_core_runtime::salesforce::SalesforceConnectionParams::default();
        let channel = dashql_core_runtime::salesforce::SharedSalesforceChannel::new(
            ConnectorType::SalesforceDataCloud,
            &params,
            tokens.clone(),
        );
        dashql_core_runtime::connections::ConnectionChannel::Salesforce(channel.expect("a channel"))
    });
    match start_connection_client_function(ConnectorType::SalesforceDataCloud, spec(), description, NOW)? {
        ConnectionCallStart::Explained(result) => Ok((result, sent)),
        ConnectionCallStart::Running { binding, mut run, mut step } => {
            let mut result = ClientFunctionResult { fields: run.fields(), rows: Vec::new() };
            loop {
                if let Some(rows) = run.take_rows() {
                    result.rows.extend(rows.rows);
                }
                step = match step {
                    CallStep::Send(request) => {
                        sent.push(binding.http_request(channel.as_ref(), &request, NOW)?);
                        run.on_response(HttpResponse::new(200, body.to_string()), NOW)?
                    }
                    CallStep::Sleep { .. } => panic!("no wait"),
                    CallStep::Done => return Ok((result, sent)),
                }
            }
        }
    }
}

#[test]
fn sends_the_request_of_the_spec_to_its_host_with_its_token() {
    let tokens = tokens();
    let (result, sent) = execute(
        &d360("segment_list", json!({ "batch_size": 10 }), false),
        Some(&tokens),
        json!({ "segments": [{ "apiName": "Vip" }] }),
    )
    .unwrap();
    assert_eq!(sent[0].url, "https://org.my.salesforce.com/services/data/v68.0/ssot/segments?batchSize=10");
    assert_eq!(sent[0].header("Authorization"), Some("Bearer core-token"));
    assert_eq!(result.cell(0, "api_name").and_then(Cell::as_str), Some("Vip"));
    // The host reads the result as Arrow
    assert_eq!(result.to_record_batch().unwrap().num_rows(), 1);
}

#[test]
fn prints_a_request_without_a_login_and_sends_nothing() {
    let (result, sent) =
        execute(&d360("segment_delete", json!({ "segment_api_name": "Vip" }), true), None, json!({})).unwrap();
    assert!(sent.is_empty());
    assert_eq!(result.cell(0, "method").and_then(Cell::as_str), Some("DELETE"));
    assert_eq!(result.cell(0, "path").and_then(Cell::as_str), Some("/services/data/v68.0/ssot/segments/Vip"));
}

#[test]
fn fails_without_a_login() {
    let error = execute(&d360("segment_list", json!({}), false), None, json!({})).unwrap_err();
    assert!(error.message.contains("not set up"), "{error}");
}

#[test]
fn sends_a_write_such_as_creating_a_connection() {
    let tokens = tokens();
    let mut create = d360(
        "connection_create",
        json!({ "connector_type": "SNOWFLAKE", "label": "Snowflake prod", "name": "snowflake_prod", "method": "Ingress" }),
        false,
    );
    create.effect = "write".into();
    let (result, sent) =
        execute(&create, Some(&tokens), json!({ "id": "0Xx000000000001", "name": "snowflake_prod" })).unwrap();
    assert_eq!(
        (sent[0].method.as_str(), sent[0].url.as_str()),
        ("POST", "https://org.my.salesforce.com/services/data/v68.0/ssot/connections")
    );
    let body: Value = serde_json::from_str(sent[0].body.as_deref().unwrap()).unwrap();
    assert_eq!(
        body,
        json!({ "connectorType": "SNOWFLAKE", "label": "Snowflake prod", "name": "snowflake_prod", "method": "Ingress" })
    );
    assert_eq!(result.cell(0, "_status"), Some(&Cell::Int32(200)));
}

#[test]
fn fails_on_a_connector_without_the_namespace() {
    let error =
        start_connection_client_function(ConnectorType::Hyper, spec(), &d360("segment_list", json!({}), false), NOW)
            .unwrap_err();
    assert!(error.message.contains("no client functions"), "{error}");
    let other = ClientFunctionCallDescription { namespace: "other".into(), ..d360("x", json!({}), false) };
    let error = start_connection_client_function(ConnectorType::SalesforceDataCloud, spec(), &other, NOW).unwrap_err();
    assert!(error.message.contains("no client functions in other"), "{error}");
}

#[test]
fn the_binding_fills_in_every_host_of_the_spec() {
    let tokens = tokens();
    let spec = spec();
    assert!(!spec.hosts.is_empty());
    for host in spec.hosts.keys() {
        assert!(resolve_salesforce_client_function_host(Some(&tokens), host, NOW).is_ok(), "{host}");
    }
}
