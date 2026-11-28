//! The Salesforce connector, with the setup as a state machine.

use std::collections::BTreeMap;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dashql_core_runtime::connections::sharing::sanitize_connection_params_for_sharing;
use dashql_core_runtime::connections::OAuthPkceChallenge;
use dashql_core_runtime::http::HttpResponse;
use dashql_core_runtime::salesforce::api::*;
use dashql_core_runtime::salesforce::auth::*;
use dashql_core_runtime::salesforce::*;
use serde_json::{json, Value};

/// 2026-01-01T00:00:00.000Z
const NOW: f64 = 1_767_225_600_000.0;

fn response(body: Value, status: u16) -> HttpResponse {
    HttpResponse::new(status, body.to_string()).with_status_text(if status == 200 { "OK" } else { "Error" })
}

fn ok(body: Value) -> HttpResponse {
    response(body, 200)
}

fn encode_jwt_part(value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(value.to_string().as_bytes())
}

fn core_token(instance_url: &str) -> SalesforceCoreAccessToken {
    SalesforceCoreAccessToken {
        access_token: "core-token".into(),
        instance_url: Some(instance_url.into()),
        ..Default::default()
    }
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
    let mut load = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com/"), "Marketing Space");
    let mut urls: Vec<&str> = load.requests().iter().map(|r| r.url.as_str()).collect();
    urls.sort();
    let mut expected: Vec<String> = SALESFORCE_METADATA_ENTITY_TYPES
        .iter()
        .map(|entity_type| {
            format!("https://example.my.salesforce.com/services/data/{SALESFORCE_API_VERSION}/ssot/metadata?dataspace=Marketing+Space&entityType={entity_type}")
        })
        .collect();
    expected.sort();
    assert_eq!(urls, expected);
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
    for (i, body) in bodies.into_iter().enumerate() {
        assert!(load.on_response(i, &ok(body)).is_none());
    }
    let entities = load.finish().unwrap();
    assert_eq!(names(&entities), ["Individual__dlm", "Account__dll", "Revenue__cio"]);
    assert_eq!(entities[0]["fields"][0]["name"], "FirstName__c");
    assert_eq!(entities[2]["fields"][0]["name"], "Amount__c");
}

/// The names of metadata entities
fn names(entities: &[Value]) -> Vec<&str> {
    entities.iter().map(|entity| entity["name"].as_str().unwrap()).collect()
}

#[test]
fn returns_successful_metadata_and_logs_details_when_one_request_fails() {
    let mut load = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    let mut failures = Vec::new();
    for (i, entity_type) in SALESFORCE_METADATA_ENTITY_TYPES.iter().enumerate() {
        let answer = if *entity_type == "DataLakeObject" {
            response(json!({ "error": "unavailable" }), 503)
        } else {
            ok(json!({ "metadata": [{ "name": entity_type, "fields": [] }] }))
        };
        failures.extend(load.on_response(i, &answer));
    }
    assert_eq!(failures.len(), 1);
    assert_eq!((failures[0].data_space.as_str(), failures[0].entity_type.as_str()), ("default", "DataLakeObject"));
    assert!(failures[0].error.contains("503"), "{}", failures[0].error);
    assert_eq!(names(&load.finish().unwrap()), ["DataModelObject", "CalculatedInsight"]);
}

#[test]
fn rejects_with_only_the_summary_when_every_metadata_request_fails() {
    let mut load = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    let types = SALESFORCE_METADATA_ENTITY_TYPES.len();
    let failures: Vec<_> =
        (0..types).filter_map(|i| load.on_response(i, &response(json!({ "error": "unavailable" }), 503))).collect();
    assert_eq!(failures.len(), types);
    // The message is the summary, without the errors of the requests
    let message = load.finish().unwrap_err().message;
    assert!(message.contains(&format!("{types} failed")), "{message}");
    assert!(!message.contains("unavailable"), "{message}");
}

#[test]
fn starts_all_metadata_requests_before_waiting_for_responses() {
    let mut load = SalesforceMetadataLoad::new(&core_token("https://example.my.salesforce.com"), "default");
    assert_eq!(load.requests().len(), SALESFORCE_METADATA_ENTITY_TYPES.len());
    assert!(load.finish().is_err());
    // A request that fails without a response counts as failed
    load.on_failure(1, "network down").unwrap();
    for i in [0, 2] {
        assert!(load.on_response(i, &ok(json!({ "metadata": [] }))).is_none());
    }
    assert!(load.finish().unwrap().is_empty());
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
    let raw = format!(
        "{}.{}.signature",
        encode_jwt_part(&json!({ "alg": "RS256", "marker": "\u{ffff}\u{ffff}\u{ffff}" })),
        encode_jwt_part(&payload)
    );
    assert!(raw.contains(['-', '_']));
    let core = parse_core_access_token(
        &json!({ "access_token": "opaque-core-token", "instance_url": "https://example.my.salesforce.com" }),
        NOW,
    )
    .unwrap();
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
    assert_eq!(
        get_salesforce_data_cloud_url(Some("configured.example.com")).unwrap(),
        "https://configured.example.com/"
    );
    assert_eq!(token.jwt.payload["audienceTenantId"], "tenant-1");
    // The token crosses to the connection state as JSON and back
    let json = serde_json::to_string(&token).unwrap();
    assert_eq!(serde_json::from_str::<SalesforceDataCloudAccessToken>(&json).unwrap(), token);
}

#[test]
fn allows_opaque_core_credentials() {
    for access_token in ["opaque-token", "a.b", "a.b.", "a.b.c"] {
        assert_eq!(
            parse_core_access_token(&json!({ "access_token": access_token }), NOW).unwrap().access_token,
            access_token
        );
    }
}

#[test]
fn exchanges_the_authorization_code_for_an_opaque_core_token_using_pkce() {
    let params = SalesforceConnectionParams {
        instance_url: "https://core.example.com".into(),
        app_consumer_key: "key".into(),
        ..Default::default()
    };
    let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
    let request = core_access_token_request(&config, &params, "code", "verifier");
    assert_eq!(request.url, "https://core.example.com/services/oauth2/token");
    // The host keeps no record of the code, the verifier and the token
    assert!(request.sensitive);
    assert!(data_cloud_access_token_request(&core_token("https://core.example.com")).sensitive);
    let fields = form(request.body.as_deref().unwrap());
    assert_eq!(fields["grant_type"], "authorization_code");
    assert_eq!(fields["code_verifier"], "verifier");
    assert_eq!(fields["redirect_uri"], "https://dashql.app/oauth.html");
    assert!(!fields.contains_key("client_secret"));
    let token = read_core_access_token_response(
        &request,
        &ok(json!({ "access_token": "opaque-core-token", "instance_url": "https://core.example.com" })),
        NOW,
    )
    .unwrap();
    assert_eq!(token.access_token, "opaque-core-token");
    // A secret goes along if the connected app has one
    let with_secret = SalesforceConnectionParams { app_consumer_secret: "s".into(), ..params };
    assert_eq!(
        form(core_access_token_request(&config, &with_secret, "c", "v").body.as_deref().unwrap())["client_secret"],
        "s"
    );
}

fn exchange(payload: Value, instance_url: Value) -> Result<SalesforceDataCloudAccessToken, SalesforceError> {
    let raw = format!("{}.{}.signature", encode_jwt_part(&json!({ "alg": "RS256" })), encode_jwt_part(&payload));
    let request = data_cloud_access_token_request(&core_token("https://core.example.com"));
    read_data_cloud_access_token_response(
        &request,
        &ok(json!({ "access_token": raw, "instance_url": instance_url })),
        NOW,
    )
}

#[test]
fn restores_string_expiration_and_legacy_custom_attributes_from_the_exchange() {
    let token = exchange(json!({ "exp": "1800000000", "audienceTenantId": "tenant-1", "custom_attributes": { "dataspace": "Marketing" } }), json!("data.example.com")).unwrap();
    assert_eq!(token.expires_at, "2027-01-15T08:00:00.000Z");
    assert_eq!(get_salesforce_data_space(&token), "Marketing");
}

#[test]
fn rejects_an_unusable_exchanged_endpoint() {
    for instance_url in [
        json!(null),
        json!("http://data.example.com"),
        json!("https://data.example.com/path"),
        json!("https://u@data.example.com"),
    ] {
        assert!(exchange(json!({ "exp": 1_800_000_000 }), instance_url.clone()).is_err(), "{instance_url}");
    }
}

#[test]
fn rejects_invalid_data_cloud_expiration_claims() {
    for exp in [json!(null), json!("invalid"), json!(1e100)] {
        let error = exchange(json!({ "exp": exp }), json!("data.example.com")).unwrap_err();
        assert!(error.message.contains("expiration"), "{exp}: {error}");
        assert!(error.diagnostics.unwrap().message.contains("Data Cloud token"));
    }
}

#[test]
fn logs_failed_exchange_responses_with_credentials_and_identities_redacted() {
    let payload = json!({
        "exp": 1, "scp": ["api", "data_cloud_user_claims"], "sub": "private-user@example.com",
        "user_claims": { "cdp_tenant": "private-tenant", "user-id": "private-user-id", "org-id": "private-org-id" },
        "sfap_op": "private-opaque-context",
    });
    let access_token =
        format!("{}.{}.private-signature", encode_jwt_part(&json!({ "alg": "RS256" })), encode_jwt_part(&payload));
    let body = json!({
        "access_token": access_token, "refresh_token": "private-refresh-token", "id_token": "private-id-token",
        "signature": "private-response-signature", "scope": "api data_cloud_user_claims", "token_format": "jwt",
        "token_type": "Bearer", "expires_in": 7200, "error": "invalid_grant", "error_description": "exchange denied",
    });
    let request = data_cloud_access_token_request(&core_token("https://example.my.salesforce.com"));
    let error = read_data_cloud_access_token_response(&request, &response(body, 400), NOW).unwrap_err();
    assert_eq!(error.message, "exchange denied");
    let diagnostics = error.diagnostics.unwrap();
    assert!(diagnostics.message.contains("Data Cloud token"), "{}", diagnostics.message);
    assert_eq!(diagnostics.status, Some(400));
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
    let nested =
        redact_token_diagnostics(&json!({ "user": { "user-id": "u", "name": "n", "email": "e", "scope": "s" } }));
    assert_eq!(
        serde_json::from_str::<Value>(&nested).unwrap(),
        json!({ "user": { "user-id": "<redacted>", "name": "<redacted>", "email": "<redacted>", "scope": "s" } })
    );
}

#[test]
fn logs_safe_diagnostics_for_missing_core_credentials() {
    for obj in [json!({}), json!({ "access_token": "" }), json!({ "access_token": "", "refresh_token": "private" })] {
        let error = parse_core_access_token(&obj, NOW).unwrap_err();
        let diagnostics = error.diagnostics.unwrap();
        assert!(diagnostics.message.contains("token"), "{}", diagnostics.message);
        assert!(!diagnostics.oauth_response.contains("private"));
    }
}

#[test]
fn rejects_http_errors_even_without_an_oauth_error_body() {
    for status in [401, 500] {
        let params = SalesforceConnectionParams {
            instance_url: "https://core.example.com".into(),
            app_consumer_key: "key".into(),
            ..Default::default()
        };
        let config = SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() };
        let answer = response(json!({ "access_token": "private-token" }), status);
        let core = read_core_access_token_response(
            &core_access_token_request(&config, &params, "code", "verifier"),
            &answer,
            NOW,
        );
        assert!(core.unwrap_err().message.contains(&status.to_string()));
        let data_cloud = read_data_cloud_access_token_response(
            &data_cloud_access_token_request(&core_token(&params.instance_url)),
            &answer,
            NOW,
        );
        assert!(data_cloud.unwrap_err().message.contains(&status.to_string()));
    }
}

#[test]
fn requests_the_user_info_with_the_core_token_and_maps_the_fields() {
    let request = core_user_info_request(&core_token("https://core.example.com"));
    // The token goes in the bearer header only, never in the URL
    assert_eq!(request.url, "https://core.example.com/services/oauth2/userinfo?format=json");
    assert_eq!(request.header("authorization"), Some("Bearer core-token"));
    assert!(request.sensitive);
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
        jwt: SalesforceDataCloudJwt {
            raw: "data-cloud-token".into(),
            header: json!({}),
            payload: json!({ "customAttributes": attributes }),
        },
        ..Default::default()
    }
}

#[test]
fn resolves_the_data_space() {
    assert_eq!(
        get_salesforce_data_space(&with_attributes(json!({ "data": { "dataspace": "Marketing" } }))),
        "Marketing"
    );
    assert_eq!(get_salesforce_data_space(&with_attributes(json!({ "dataspace": "Sales" }))), "Sales");
    assert_eq!(get_salesforce_data_space(&with_attributes(json!({}))), DEFAULT_SALESFORCE_DATA_SPACE);
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
    OAuthFlowInfo {
        redirect_variant: "WEB_OPENER_FLOW".into(),
        redirect_callback_url: None,
        debug_mode: false,
        flavor: None,
    }
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
    let callback =
        |state: OAuthState| OAuthRedirectData { state: Some(state), code: Some("code".into()), ..Default::default() };
    assert!(validate_salesforce_oauth_callback_state(&callback(expected.clone()), &expected, NOW as i64).is_ok());
    let other_flow = OAuthState { flow_id: "flow-2".into(), ..expected.clone() };
    assert!(validate_salesforce_oauth_callback_state(&callback(other_flow), &expected, NOW as i64)
        .unwrap_err()
        .message
        .contains("flow ID"));
    let other_variant = OAuthState { flow_variant: "NATIVE_LINK_FLOW".into(), ..expected.clone() };
    assert!(validate_salesforce_oauth_callback_state(&callback(other_variant), &expected, NOW as i64)
        .unwrap_err()
        .message
        .contains("variant"));
    let mut other_app = expected.clone();
    other_app.salesforce_provider.as_mut().unwrap().app_consumer_key = "other".into();
    assert!(validate_salesforce_oauth_callback_state(&callback(other_app), &expected, NOW as i64)
        .unwrap_err()
        .message
        .contains("provider does not match"));
    let later = NOW as i64 + OAUTH_FLOW_LIFETIME_MS;
    assert!(validate_salesforce_oauth_callback_state(&callback(expected.clone()), &expected, later)
        .unwrap_err()
        .message
        .contains("expired"));
    let without = OAuthRedirectData::default();
    assert!(validate_salesforce_oauth_callback_state(&without, &expected, NOW as i64)
        .unwrap_err()
        .message
        .contains("missing"));
}

// The params

#[test]
fn shares_params_without_the_secret() {
    let object = json!({ "instanceUrl": "https://org", "appConsumerKey": "k", "appConsumerSecret": "s", "login": "u" });
    let object = object.as_object().unwrap();
    let sanitize = |with_login_hint: bool| {
        sanitize_connection_params_for_sharing(&json!({ "salesforce": object }), with_login_hint)["salesforce"].clone()
    };
    let shared = sanitize(false);
    assert_eq!((shared["appConsumerSecret"].as_str(), shared["login"].as_str()), (Some(""), Some("")));
    assert_eq!(sanitize(true)["login"], "u");
    assert_eq!(login_hint(object), Some("u"));
}
