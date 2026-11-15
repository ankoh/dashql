//! The Salesforce connector, ported from `salesforce_api_client.test.ts` and `salesforce_client_functions.test.ts` of
//! `packages/dashql-runtime/src/connections/salesforce/`, with the setup as a state machine.

use std::collections::BTreeMap;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dashql_core_runtime::clfn::{HttpRequest, HttpResponse};
use dashql_core_runtime::connections::{ConnectorType, OAuthPkceChallenge, SalesforceAction};
use dashql_core_runtime::salesforce::api::*;
use dashql_core_runtime::salesforce::auth::*;
use dashql_core_runtime::salesforce::client_functions::*;
use dashql_core_runtime::salesforce::setup::*;
use dashql_core_runtime::salesforce::*;
use serde_json::{json, Value};

/// 2026-01-01T00:00:00.000Z
const NOW: f64 = 1_767_225_600_000.0;

fn response(body: Value, status: u16) -> HttpResponse {
    HttpResponse { status, status_text: if status == 200 { "OK" } else { "Error" }.into(), headers: Vec::new(), body: body.to_string() }
}

fn ok(body: Value) -> HttpResponse {
    response(body, 200)
}

fn encode_jwt_part(value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(value.to_string().as_bytes())
}

fn core_token(instance_url: &str) -> SalesforceCoreAccessToken {
    SalesforceCoreAccessToken { access_token: "core-token".into(), instance_url: Some(instance_url.into()), ..Default::default() }
}

/// The form fields of a body
fn form(body: &str) -> BTreeMap<String, String> {
    body.split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (k.to_string(), v.replace('+', " ").replace("%3A", ":").replace("%2F", "/")))
        .collect()
}

// The metadata

#[test]
fn requests_metadata_separately_for_each_entity_type() {
    let (mut load, progress) = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com/"), "Marketing Space");
    assert!(progress.iter().all(|p| p.state == SalesforceMetadataState::Requesting));
    let mut urls: Vec<&str> = load.requests().iter().map(|r| r.url.as_str()).collect();
    urls.sort();
    assert_eq!(
        urls,
        [
            "https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=CalculatedInsight",
            "https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataLakeObject",
            "https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataModelObject",
        ]
    );
    for request in load.requests() {
        assert_eq!(request.header("authorization"), Some("Bearer core-token"));
    }
    let bodies = [
        json!({ "metadata": [{
            "name": "Individual__dlm", "displayName": "Individual DMO", "category": "Profile",
            "fields": [{ "name": "FirstName__c", "displayName": "First Name", "type": "Text", "businessType": "Text" }],
            "primaryKeys": [{ "indexOrder": "0", "name": "Id__c", "displayName": "ID" }],
        }] }),
        json!({ "metadata": [{ "name": "Account__dll", "displayName": "Account DLO", "category": "Profile", "fields": [{ "name": "AccountId__c" }], "primaryKeys": [] }] }),
        json!({ "metadata": [{ "name": "Revenue__cio", "category": "CalculatedInsight", "fields": [{ "name": "Amount__c", "type": "Number" }] }] }),
    ];
    let mut reported = Vec::new();
    for (i, body) in bodies.into_iter().enumerate() {
        let (progress, failure) = load.on_response(i, &ok(body)).unwrap();
        assert!(failure.is_none());
        reported.push(progress);
    }
    let metadata = load.finish().unwrap();
    assert_eq!(metadata.metadata.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["Individual__dlm", "Account__dll", "Revenue__cio"]);
    assert_eq!(metadata.metadata[0].fields[0].name, "FirstName__c");
    assert_eq!(metadata.metadata[0].primary_keys[0].name, "Id__c");
    assert_eq!(metadata.metadata[2].fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["Amount__c"]);
    assert_eq!(
        reported[0],
        SalesforceMetadataProgress {
            collection: "DataModelObject".into(),
            page: 1,
            loaded: 1,
            total: Some(1),
            state: SalesforceMetadataState::Complete,
            error: None,
        }
    );
}

#[test]
fn returns_successful_metadata_and_logs_details_when_one_request_fails() {
    let (mut load, _) = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    let mut states = Vec::new();
    for (i, entity_type) in SALESFORCE_METADATA_ENTITY_TYPES.iter().enumerate() {
        let answer = if *entity_type == "DataLakeObject" {
            response(json!({ "error": "unavailable" }), 503)
        } else {
            ok(json!({ "metadata": [{ "name": entity_type, "fields": [] }] }))
        };
        let (progress, failure) = load.on_response(i, &answer).unwrap();
        states.push(progress.state);
        if let Some(failure) = failure {
            assert_eq!(
                failure,
                SalesforceMetadataFailure {
                    data_space: "default".into(),
                    entity_type: "DataLakeObject".into(),
                    error: "503 Error — {\"error\":\"unavailable\"}".into(),
                }
            );
        }
    }
    assert_eq!(states.iter().filter(|s| **s == SalesforceMetadataState::Complete).count(), 2);
    assert_eq!(states.iter().filter(|s| **s == SalesforceMetadataState::Failed).count(), 1);
    let metadata = load.finish().unwrap();
    assert_eq!(metadata.metadata.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["DataModelObject", "CalculatedInsight"]);
}

#[test]
fn rejects_with_only_the_summary_when_every_metadata_request_fails() {
    let (mut load, _) = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    let failures: Vec<_> = (0..3).filter_map(|i| load.on_response(i, &response(json!({ "error": "unavailable" }), 503))?.1).collect();
    assert_eq!(failures.len(), 3);
    assert_eq!(load.finish().unwrap_err().message, "Metadata: 0 done, 0 active, 3 failed | DMO failed | DLO failed | CI failed");
}

#[test]
fn starts_all_metadata_requests_before_waiting_for_responses() {
    let (mut load, _) = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    assert_eq!(load.requests().len(), 3);
    assert!(load.finish().is_err());
    // A request that fails without a response counts as failed
    load.on_failure(1, "network down").unwrap();
    for i in [0, 2] {
        load.on_response(i, &ok(json!({ "metadata": [] }))).unwrap();
    }
    assert_eq!(load.finish().unwrap(), SalesforceDataCloudMetadata { metadata: vec![] });
}

#[test]
fn formats_aggregate_progress_for_all_three_metadata_requests() {
    let progress = |collection: &str, loaded, total, state| SalesforceMetadataProgress {
        collection: collection.into(),
        page: 1,
        loaded,
        total,
        state,
        error: None,
    };
    let map = BTreeMap::from([
        ("DataModelObject".to_string(), progress("DataModelObject", 120, Some(120), SalesforceMetadataState::Complete)),
        ("DataLakeObject".to_string(), progress("DataLakeObject", 0, None, SalesforceMetadataState::Requesting)),
        ("CalculatedInsight".to_string(), progress("CalculatedInsight", 0, None, SalesforceMetadataState::Failed)),
    ]);
    assert_eq!(format_salesforce_metadata_progress(&map), "Metadata: 1 done, 1 active, 1 failed | DMO 120 | DLO - | CI failed");
    assert_eq!(format_salesforce_metadata_progress(&BTreeMap::new()), "Metadata: 0 done, 0 active, 0 failed, 3 pending | DMO - | DLO - | CI -");
}

// The tokens

#[test]
fn decodes_base64url_jwt_parts_without_changing_the_raw_token() {
    let payload = json!({
        "exp": 1_800_000_000,
        "audienceTenantId": "tenant-1",
        "sfoid": "org-1",
        "aud": ["https://api.salesforce.com", "https://example.my.salesforce.com"],
        "scp": ["api", "sfap_api", "cdp_query_api", "data_cloud_user_claims"],
        "customAttributes": { "dataspace": "Marketing" },
    });
    let raw = format!("{}.{}.signature", encode_jwt_part(&json!({ "alg": "RS256", "marker": "\u{ffff}\u{ffff}\u{ffff}" })), encode_jwt_part(&payload));
    assert!(raw.contains(['-', '_']));
    let core = parse_core_access_token(&json!({ "access_token": "opaque-core-token", "instance_url": "https://example.my.salesforce.com" }), NOW).unwrap();
    let request = data_cloud_access_token_request(&core);
    assert_eq!(request.url, "https://example.my.salesforce.com/services/a360/token");
    let fields = form(request.body.as_deref().unwrap());
    assert_eq!(fields["grant_type"], "urn:salesforce:grant-type:external:cdp");
    assert_eq!(fields["subject_token"], "opaque-core-token");
    assert_eq!(fields["subject_token_type"], "urn:ietf:params:oauth:token-type:access_token");
    assert!(!fields.contains_key("client_secret"));

    let answer = ok(json!({ "access_token": raw, "instance_url": "data.example.com", "token_type": "Bearer" }));
    let token = read_data_cloud_access_token_response(&request, &answer, NOW).unwrap();
    assert_eq!(token.jwt.raw, raw);
    assert_eq!(token.jwt.payload, payload);
    assert_eq!(token.expires_at, "2027-01-15T08:00:00.000Z");
    assert_eq!(token.created_at, "2026-01-01T00:00:00.000Z");
    assert_eq!(get_salesforce_data_space(&token), "Marketing");
    assert_eq!(token.instance_url, "https://data.example.com/");
    assert_eq!(get_salesforce_data_cloud_url(Some("configured.example.com")).unwrap(), "https://configured.example.com/");
    let info = collect_salesforce_auth_info(&core, &token).unwrap();
    assert_eq!(info.core_access_token.as_deref(), Some("opaque-core-token"));
    assert_eq!(info.core_tenant_id.as_deref(), Some("tenant-1"));
    assert_eq!(info.offcore_tenant_id.as_deref(), Some("tenant-1"));
    assert_eq!(info.offcore_instance_url.as_deref(), Some("https://data.example.com/"));
    assert_eq!(info.offcore_raw_jwt, raw);
    // The token crosses to the connection state as JSON and back
    let json = serde_json::to_string(&token).unwrap();
    assert_eq!(serde_json::from_str::<SalesforceDataCloudAccessToken>(&json).unwrap(), token);
}

#[test]
fn allows_opaque_core_credentials() {
    for access_token in ["opaque-token", "a.b", "a.b.", "a.b.c"] {
        assert_eq!(parse_core_access_token(&json!({ "access_token": access_token }), NOW).unwrap().access_token, access_token);
    }
}

#[test]
fn exchanges_the_authorization_code_for_an_opaque_core_token_using_pkce() {
    let params = SalesforceConnectionParams { instance_url: "https://core.example.com".into(), app_consumer_key: "key".into(), ..Default::default() };
    let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
    let request = core_access_token_request(&config, &params, "code", "verifier");
    assert_eq!(request.url, "https://core.example.com/services/oauth2/token");
    let fields = form(request.body.as_deref().unwrap());
    assert_eq!(fields["grant_type"], "authorization_code");
    assert_eq!(fields["code_verifier"], "verifier");
    assert_eq!(fields["redirect_uri"], "https://dashql.app/oauth.html");
    assert!(!fields.contains_key("client_secret"));
    let token = read_core_access_token_response(&request, &ok(json!({ "access_token": "opaque-core-token", "instance_url": "https://core.example.com" })), NOW).unwrap();
    assert_eq!(token.access_token, "opaque-core-token");
    // A secret goes along if the connected app has one
    let with_secret = SalesforceConnectionParams { app_consumer_secret: "s".into(), ..params };
    assert_eq!(form(core_access_token_request(&config, &with_secret, "c", "v").body.as_deref().unwrap())["client_secret"], "s");
}

fn exchange(payload: Value, instance_url: Value) -> Result<SalesforceDataCloudAccessToken, SalesforceError> {
    let raw = format!("{}.{}.signature", encode_jwt_part(&json!({ "alg": "RS256" })), encode_jwt_part(&payload));
    let request = data_cloud_access_token_request(&core_token("https://core.example.com"));
    read_data_cloud_access_token_response(&request, &ok(json!({ "access_token": raw, "instance_url": instance_url })), NOW)
}

#[test]
fn restores_string_expiration_and_legacy_custom_attributes_from_the_exchange() {
    let token = exchange(json!({ "exp": "1800000000", "audienceTenantId": "tenant-1", "custom_attributes": { "dataspace": "Marketing" } }), json!("data.example.com")).unwrap();
    assert_eq!(token.expires_at, "2027-01-15T08:00:00.000Z");
    assert_eq!(get_salesforce_data_space(&token), "Marketing");
}

#[test]
fn rejects_an_unusable_exchanged_endpoint() {
    for instance_url in [json!(null), json!("http://data.example.com"), json!("https://data.example.com/path"), json!("https://u@data.example.com")] {
        assert!(exchange(json!({ "exp": 1_800_000_000 }), instance_url.clone()).is_err(), "{instance_url}");
    }
}

#[test]
fn rejects_invalid_data_cloud_expiration_claims() {
    for exp in [json!(null), json!("invalid"), json!(1e100)] {
        let error = exchange(json!({ "exp": exp }), json!("data.example.com")).unwrap_err();
        assert!(error.message.contains("expiration"), "{exp}: {error}");
        assert_eq!(error.diagnostics.unwrap().message, "Rejected Data Cloud token response");
    }
}

#[test]
fn logs_failed_exchange_responses_with_credentials_and_identities_redacted() {
    let payload = json!({
        "exp": 1, "scp": ["api", "data_cloud_user_claims"], "sub": "private-user@example.com",
        "user_claims": { "cdp_tenant": "private-tenant", "user-id": "private-user-id", "org-id": "private-org-id" },
        "sfap_op": "private-opaque-context",
    });
    let access_token = format!("{}.{}.private-signature", encode_jwt_part(&json!({ "alg": "RS256" })), encode_jwt_part(&payload));
    let body = json!({
        "access_token": access_token, "refresh_token": "private-refresh-token", "id_token": "private-id-token",
        "signature": "private-response-signature", "scope": "api data_cloud_user_claims", "token_format": "jwt",
        "token_type": "Bearer", "expires_in": 7200, "error": "invalid_grant", "error_description": "exchange denied",
    });
    let request = data_cloud_access_token_request(&core_token("https://example.my.salesforce.com"));
    let error = read_data_cloud_access_token_response(&request, &response(body, 400), NOW).unwrap_err();
    assert_eq!(error.message, "exchange denied");
    let diagnostics = error.diagnostics.unwrap();
    assert_eq!((diagnostics.message.as_str(), diagnostics.status), ("Data Cloud token request failed", Some(400)));
    let logged: Value = serde_json::from_str(&diagnostics.oauth_response).unwrap();
    assert_eq!(
        logged,
        json!({
            "access_token": "<redacted>", "refresh_token": "<redacted>", "id_token": "<redacted>", "signature": "<redacted>",
            "scope": "api data_cloud_user_claims", "token_format": "jwt", "token_type": "Bearer", "expires_in": 7200,
            "error": "invalid_grant", "error_description": "exchange denied",
        })
    );
    for secret in [access_token.as_str(), "private-refresh-token", "private-id-token", "private-response-signature"] {
        assert!(!diagnostics.oauth_response.contains(secret));
    }
    // Identities are redacted at every level
    let nested = redact_token_diagnostics(&json!({ "user": { "user-id": "u", "name": "n", "email": "e", "scope": "s" } }));
    assert_eq!(serde_json::from_str::<Value>(&nested).unwrap(), json!({ "user": { "user-id": "<redacted>", "name": "<redacted>", "email": "<redacted>", "scope": "s" } }));
}

#[test]
fn logs_safe_diagnostics_for_missing_core_credentials() {
    for obj in [json!({}), json!({ "access_token": "" }), json!({ "access_token": "", "refresh_token": "private" })] {
        let error = parse_core_access_token(&obj, NOW).unwrap_err();
        let diagnostics = error.diagnostics.unwrap();
        assert_eq!(diagnostics.message, "Rejected Salesforce OAuth token response");
        assert!(!diagnostics.oauth_response.contains("private"));
    }
}

#[test]
fn rejects_http_errors_even_without_an_oauth_error_body() {
    for status in [401, 500] {
        let params = SalesforceConnectionParams { instance_url: "https://core.example.com".into(), app_consumer_key: "key".into(), ..Default::default() };
        let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
        let answer = response(json!({ "access_token": "private-token" }), status);
        let core = read_core_access_token_response(&core_access_token_request(&config, &params, "code", "verifier"), &answer, NOW);
        assert!(core.unwrap_err().message.contains(&status.to_string()));
        let data_cloud = read_data_cloud_access_token_response(&data_cloud_access_token_request(&core_token(&params.instance_url)), &answer, NOW);
        assert!(data_cloud.unwrap_err().message.contains(&status.to_string()));
    }
}

#[test]
fn requests_the_user_info_with_the_core_token_and_maps_the_fields() {
    let request = core_user_info_request(&core_token("https://core.example.com"));
    assert_eq!(request.url, "https://core.example.com/services/oauth2/userinfo?format=json&access_token=core-token");
    assert_eq!(request.header("authorization"), Some("Bearer core-token"));
    let info = read_core_user_info_response(&ok(json!({
        "email": "user@example.com", "email_verified": true, "preferred_username": "user@example.com.org",
        "organization_id": "00D000000000001", "user_id": "005000000000001", "utcOffset": 3_600_000,
    })))
    .unwrap();
    assert_eq!(info.email.as_deref(), Some("user@example.com"));
    assert_eq!(info.email_verified, Some(true));
    assert_eq!(info.preferred_username.as_deref(), Some("user@example.com.org"));
    assert_eq!(info.organization_id.as_deref(), Some("00D000000000001"));
    assert_eq!(info.user_id.as_deref(), Some("005000000000001"));
    assert_eq!(info.utc_offset, Some(3_600_000));
}

fn with_attributes(attributes: Value) -> SalesforceDataCloudAccessToken {
    SalesforceDataCloudAccessToken {
        jwt: SalesforceDataCloudJwt { raw: "data-cloud-token".into(), header: json!({}), payload: json!({ "customAttributes": attributes }) },
        ..Default::default()
    }
}

#[test]
fn resolves_the_data_space() {
    assert_eq!(get_salesforce_data_space(&with_attributes(json!({ "data": { "dataspace": "Marketing" } }))), "Marketing");
    assert_eq!(get_salesforce_data_space(&with_attributes(json!({ "dataspace": "Sales" }))), "Sales");
    assert_eq!(get_salesforce_data_space(&with_attributes(json!({}))), DEFAULT_SALESFORCE_DATA_SPACE);
}

// The client functions of a connection

fn connected(expires_at: &str) -> SalesforceTokens {
    SalesforceTokens {
        core: core_token("https://org.my.salesforce.com"),
        data_cloud: SalesforceDataCloudAccessToken {
            instance_url: "https://tenant.c360a.salesforce.com/".into(),
            expires_at: expires_at.into(),
            jwt: SalesforceDataCloudJwt { raw: "tenant-jwt".into(), ..Default::default() },
            ..Default::default()
        },
    }
}

#[test]
fn sends_the_calls_of_a_host_with_its_token() {
    let tokens = connected("");
    for (host, url, authorization) in [
        ("core", "https://org.my.salesforce.com/", "Bearer core-token"),
        ("connect", "https://org.my.salesforce.com/", "Bearer core-token"),
        ("tenant", "https://tenant.c360a.salesforce.com/", "Bearer tenant-jwt"),
    ] {
        let target = resolve_salesforce_client_function_host(Some(&tokens), host, NOW).unwrap();
        assert_eq!(target.base_url.to_string(), url);
        assert_eq!(target.headers[0], ("Authorization".to_string(), authorization.to_string()));
    }
}

#[test]
fn says_so_when_the_token_of_the_tenant_has_expired() {
    let expired = resolve_salesforce_client_function_host(Some(&connected("2000-01-01T00:00:00Z")), "tenant", NOW).unwrap_err();
    assert!(expired.message.contains("has expired, connect again"));
    assert!(resolve_salesforce_client_function_host(Some(&connected("2999-01-01T00:00:00Z")), "tenant", NOW).is_ok());
}

#[test]
fn has_no_other_host() {
    let error = resolve_salesforce_client_function_host(Some(&connected("")), "other", NOW).unwrap_err();
    assert!(error.message.contains("no host other"));
}

#[test]
fn needs_a_login_for_a_host_and_none_for_the_variables() {
    let error = resolve_salesforce_client_function_host(None, "core", NOW).unwrap_err();
    assert!(error.message.contains("not set up"));
    assert_eq!(salesforce_client_function_variables(), BTreeMap::from([("api_version".to_string(), "68.0".to_string())]));
}

// The authorization

fn params() -> SalesforceConnectionParams {
    SalesforceConnectionParams {
        instance_url: "https://org.my.salesforce.com".into(),
        app_consumer_key: "consumer-key".into(),
        login: "user@example.com".into(),
        ..Default::default()
    }
}

fn flow() -> OAuthFlowInfo {
    OAuthFlowInfo { redirect_variant: "WEB_OPENER_FLOW".into(), redirect_callback_url: None, debug_mode: false, flavor: None }
}

fn pkce() -> OAuthPkceChallenge {
    OAuthPkceChallenge { value: "challenge".into(), verifier: "verifier".into() }
}

#[test]
fn builds_the_authorization_url_with_the_state_of_the_flow() {
    let state = salesforce_oauth_state(&params(), &flow(), "flow-1", NOW as i64);
    let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
    let url = build_salesforce_authorization_url(&params(), &config, &pkce(), &state, true).unwrap();
    let (endpoint, query) = url.split_once('?').unwrap();
    assert_eq!(endpoint, "https://org.my.salesforce.com/services/oauth2/authorize");
    let fields = form(query);
    assert_eq!(fields["client_id"], "consumer-key");
    assert_eq!(fields["code_challenge"], "challenge");
    assert_eq!(fields["code_challenge_method"], "S256");
    assert_eq!(fields["response_type"], "code");
    assert_eq!(fields["prompt"], "login");
    assert_eq!(fields["login_hint"], "user%40example.com");
    let decoded: OAuthState = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&fields["state"]).unwrap()).unwrap();
    assert_eq!(decoded, state);
    assert_eq!(decoded.salesforce_provider.unwrap().expires_at, NOW as i64 + OAUTH_FLOW_LIFETIME_MS);
}

#[test]
fn validates_the_state_of_a_callback() {
    let expected = salesforce_oauth_state(&params(), &flow(), "flow-1", NOW as i64);
    let callback = |state: OAuthState| OAuthRedirectData { state: Some(state), code: Some("code".into()), ..Default::default() };
    assert!(validate_salesforce_oauth_callback_state(&callback(expected.clone()), &expected, NOW as i64).is_ok());
    let other_flow = OAuthState { flow_id: "flow-2".into(), ..expected.clone() };
    assert_eq!(validate_salesforce_oauth_callback_state(&callback(other_flow), &expected, NOW as i64).unwrap_err().message, "OAuth callback flow ID does not match");
    let other_variant = OAuthState { flow_variant: "NATIVE_LINK_FLOW".into(), ..expected.clone() };
    assert!(validate_salesforce_oauth_callback_state(&callback(other_variant), &expected, NOW as i64).unwrap_err().message.contains("variant"));
    let mut other_app = expected.clone();
    other_app.salesforce_provider.as_mut().unwrap().app_consumer_key = "other".into();
    assert!(validate_salesforce_oauth_callback_state(&callback(other_app), &expected, NOW as i64).unwrap_err().message.contains("provider does not match"));
    let later = NOW as i64 + OAUTH_FLOW_LIFETIME_MS;
    assert_eq!(validate_salesforce_oauth_callback_state(&callback(expected.clone()), &expected, later).unwrap_err().message, "OAuth callback state has expired");
    let without = OAuthRedirectData::default();
    assert!(validate_salesforce_oauth_callback_state(&without, &expected, NOW as i64).unwrap_err().message.contains("missing"));
}

// The setup

fn data_cloud_answer() -> HttpResponse {
    let payload = json!({ "exp": 1_800_000_000, "audienceTenantId": "tenant-1" });
    let raw = format!("{}.{}.signature", encode_jwt_part(&json!({ "alg": "RS256" })), encode_jwt_part(&payload));
    ok(json!({ "access_token": raw, "instance_url": "tenant.example.com" }))
}

fn start(connector: ConnectorType) -> (SalesforceSetup, SalesforceSetupOutput) {
    let object = serde_json::to_value(params()).unwrap().as_object().cloned().unwrap();
    let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
    SalesforceSetup::start(connector, &object, config, flow(), false)
}

fn fetched(output: &SalesforceSetupOutput) -> HttpRequest {
    match &output.step {
        SalesforceSetupStep::Fetch(request) => request.clone(),
        other => panic!("no request: {other:?}"),
    }
}

#[test]
fn sets_up_a_connection_step_by_step() {
    let (mut setup, output) = start(ConnectorType::SalesforceDataCloud);
    assert!(matches!(output.actions.as_slice(), [SalesforceAction::SetupStarted { .. }, SalesforceAction::GeneratingPkceChallenge]));
    assert_eq!(output.step, SalesforceSetupStep::GeneratePkce);

    let output = setup.on_pkce(pkce(), "flow-1", NOW);
    assert_eq!(output.actions, [SalesforceAction::GeneratedPkceChallenge(pkce())]);
    let SalesforceSetupStep::Authorize { url, flow_id } = &output.step else { panic!("{:?}", output.step) };
    assert!(url.starts_with("https://org.my.salesforce.com/services/oauth2/authorize?"));
    assert_eq!(flow_id, "flow-1");
    assert_eq!(setup.on_flow_event(OAuthFlowEvent::WindowOpened).actions, [SalesforceAction::OAuthWebWindowOpened]);

    let state = salesforce_oauth_state(&params(), &flow(), "flow-1", NOW as i64);
    let callback = OAuthRedirectData { state: Some(state), code: Some("the-code".into()), ..Default::default() };
    let output = setup.on_callback(&callback, NOW + 1000.0);
    assert!(matches!(&output.actions[..], [SalesforceAction::ReceivedCoreAuthCode(code), SalesforceAction::RequestingCoreAuthToken] if code.token == "the-code"));
    let request = fetched(&output);
    assert_eq!(request.url, "https://org.my.salesforce.com/services/oauth2/token");
    assert_eq!(form(request.body.as_deref().unwrap())["code_verifier"], "verifier");

    let output = setup.on_response(&ok(json!({ "access_token": "core", "instance_url": "https://org.my.salesforce.com" })), NOW);
    assert!(matches!(&output.actions[..], [SalesforceAction::ReceivedCoreAuthToken(json)] if json.contains("\"accessToken\":\"core\"")));
    assert!(fetched(&output).url.contains("/services/oauth2/userinfo"));

    let output = setup.on_response(&ok(json!({ "preferred_username": "user@org", "email": "user@example.com" })), NOW);
    assert_eq!(
        output.actions,
        [
            SalesforceAction::ReceivedCoreUserInfo { preferred_username: Some("user@org".into()), email: Some("user@example.com".into()) },
            SalesforceAction::RequestingDataCloudAccessToken,
        ]
    );
    assert!(fetched(&output).url.ends_with("/services/a360/token"));

    let output = setup.on_response(&data_cloud_answer(), NOW);
    assert!(matches!(&output.actions[..], [SalesforceAction::ReceivedDataCloudAccessToken(_), SalesforceAction::ChannelSetupStarted]));
    let SalesforceSetupStep::ConnectChannel(channel) = &output.step else { panic!("{:?}", output.step) };
    assert_eq!(channel.endpoint, "https://tenant.example.com/");
    assert_eq!(channel.request_metadata[0], ("audience".to_string(), "tenant-1".to_string()));
    assert!(channel.request_metadata[1].1.starts_with("Bearer "));
    assert!(channel.attached_databases.is_empty());

    let output = setup.on_channel_ready(7);
    assert_eq!(output.actions, [SalesforceAction::ChannelReady(7)]);
    let SalesforceSetupStep::Done(result) = &output.step else { panic!("{:?}", output.step) };
    assert_eq!(result.tokens.core.access_token, "core");
    assert_eq!(result.user_info.as_ref().unwrap().preferred_username.as_deref(), Some("user@org"));
}

#[test]
fn skips_the_user_info_if_it_fails() {
    let (mut setup, _) = start(ConnectorType::Dbcom);
    setup.on_pkce(pkce(), "flow-1", NOW);
    let state = salesforce_oauth_state(&params(), &flow(), "flow-1", NOW as i64);
    setup.on_callback(&OAuthRedirectData { state: Some(state), code: Some("c".into()), ..Default::default() }, NOW);
    setup.on_response(&ok(json!({ "access_token": "core", "instance_url": "https://org.my.salesforce.com" })), NOW);
    let output = setup.on_fetch_failed("offline");
    assert_eq!(output.actions, [SalesforceAction::RequestingDataCloudAccessToken]);
    assert_eq!(output.log.len(), 1);
    let output = setup.on_response(&data_cloud_answer(), NOW);
    let SalesforceSetupStep::ConnectChannel(channel) = &output.step else { panic!("{:?}", output.step) };
    // Database.com queries the configured Hyper Cloud database
    assert_eq!(channel.attached_databases, [AttachedDatabase { path: "hyper.cloud:default".into(), alias: "lakehouse".into() }]);
}

#[test]
fn stops_on_a_callback_that_is_not_its_own_or_an_error() {
    let (mut setup, _) = start(ConnectorType::SalesforceDataCloud);
    setup.on_pkce(pkce(), "flow-1", NOW);
    let state = salesforce_oauth_state(&params(), &flow(), "flow-2", NOW as i64);
    let output = setup.on_callback(&OAuthRedirectData { state: Some(state), code: Some("c".into()), ..Default::default() }, NOW);
    assert_eq!(output.step, SalesforceSetupStep::Stopped);
    assert!(matches!(&output.actions[..], [SalesforceAction::SetupFailed(e)] if e.message == "OAuth callback flow ID does not match"));

    let (mut setup, _) = start(ConnectorType::SalesforceDataCloud);
    setup.on_pkce(pkce(), "flow-1", NOW);
    let state = salesforce_oauth_state(&params(), &flow(), "flow-1", NOW as i64);
    let denied = OAuthRedirectData { state: Some(state), error: Some("access_denied".into()), error_description: Some("denied".into()), ..Default::default() };
    assert!(matches!(&setup.on_callback(&denied, NOW).actions[..], [SalesforceAction::SetupFailed(e)] if e.message == "denied"));

    let (mut setup, _) = start(ConnectorType::SalesforceDataCloud);
    assert!(matches!(&setup.cancel("aborted").actions[..], [SalesforceAction::SetupCancelled(e)] if e.message == "aborted"));
}

#[test]
fn fails_without_a_redirect() {
    let object = serde_json::to_value(params()).unwrap().as_object().cloned().unwrap();
    let (_, output) = SalesforceSetup::start(ConnectorType::SalesforceDataCloud, &object, SalesforceOAuthConfig::default(), flow(), false);
    assert!(matches!(&output.actions[..], [SalesforceAction::SetupStarted { .. }, SalesforceAction::SetupFailed(e)] if e.message == "missing oauth redirect url"));
    assert_eq!(output.step, SalesforceSetupStep::Stopped);
}

// The params

#[test]
fn shares_params_without_the_secret() {
    let object = json!({ "instanceUrl": "https://org", "appConsumerKey": "k", "appConsumerSecret": "s", "login": "u" });
    let object = object.as_object().unwrap();
    let shared = sanitize_params_for_sharing(object, false);
    assert_eq!((shared["appConsumerSecret"].as_str(), shared["login"].as_str()), (Some(""), Some("")));
    assert_eq!(sanitize_params_for_sharing(object, true)["login"], "u");
    assert_eq!(login_hint(object), Some("u"));
    assert_eq!(cache_signature(ConnectorType::SalesforceDataCloud, object), json!({ "case": "salesforce", "instanceUrl": "https://org", "appConsumerKey": "k" }));
    assert_eq!(cache_signature(ConnectorType::Dbcom, object)["databaseName"], "default");
}
