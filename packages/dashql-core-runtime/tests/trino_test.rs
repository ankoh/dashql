//! Tests of the Trino connector: the client, the channel, the Arrow conversion, the setup, the descriptor and the
//! recorded responses of a Trino server.
//!
//! The TypeScript tests mock the API client and its promises. Here a harness answers the requests of a query from
//! queues of responses and fires its timers on a fake clock.

use std::collections::VecDeque;
use std::sync::Arc;

use arrow_array::cast::AsArray;
use arrow_array::types::{
    Date32Type, Date64Type, Decimal128Type, Float32Type, Float64Type, Int16Type, Int32Type, Int64Type, Int8Type,
    Time32MillisecondType, TimestampMillisecondType,
};
use arrow_array::{Array, RecordBatch};
use arrow_schema::{DataType, Field, Schema, SchemaRef, TimeUnit};
use serde_json::{json, Value};

use dashql_core_runtime::connections::sharing::sanitize_connection_params_for_sharing;
use dashql_core_runtime::connections::{JsonObject, TrinoSessionDefaults};
use dashql_core_runtime::http::base64::{base64_decode, base64_encode};
use dashql_core_runtime::http::url::{form_encode, set_query_param};
use dashql_core_runtime::query::progress::EngineProgressPayload;
use dashql_core_runtime::trino::arrow::{
    js_number_string, parse_trino_timestamp_ms, parse_trino_type, rows_to_record_batch, TimeZoneOffsets,
};
use dashql_core_runtime::trino::descriptor::login_hint;
use dashql_core_runtime::trino::protocol::{
    parse_trino_json, read_query_info, read_result_page, read_statement_response, read_token_response,
    ResultPageOutcome, ACCESS_TOKEN_REFRESH_MARGIN_MS,
};
use dashql_core_runtime::trino::stream::{QUERY_INFO_FINAL_TIMEOUT_MS, QUERY_INFO_RETRY_MS};
use dashql_core_runtime::trino::{
    read_cancel_response, FetchOutcome, HttpMethod, HttpRequest, HttpResponse, RequestId, StreamOutput, TimerId,
    TokenRefresh, TrinoAccessToken, TrinoAuthParams, TrinoAuthType, TrinoChannel, TrinoColumn, TrinoErrorKind,
    TrinoQuery, TrinoQueryOptions, TrinoRequest, TrinoRetryPolicy, TARGET_RESULT_SIZE,
};

const ENDPOINT: &str = "https://trino.example.com";
const NEXT_URI: &str = "https://trino.example.com/v1/statement/executing/q1/y1/1";

/// A JSON value as an object
fn object(value: Value) -> JsonObject {
    match value {
        Value::Object(map) => map,
        _ => JsonObject::new(),
    }
}

/// A channel with basic auth of `user`
fn basic_channel(defaults: TrinoSessionDefaults) -> TrinoChannel {
    let auth = TrinoAuthParams {
        auth_type: TrinoAuthType::Basic,
        username: "user".into(),
        secret: "secret".into(),
        oauth: None,
    };
    TrinoChannel::new(ENDPOINT, auth, defaults)
}

/// A response with a JSON body
fn json_response(value: Value) -> FetchOutcome {
    FetchOutcome::Response(HttpResponse::new(200, value.to_string()))
}

/// A response with a status and a status text
fn status_response(status: u16, status_text: &str) -> HttpResponse {
    HttpResponse::new(status, Vec::new()).with_status_text(status_text)
}

// ---------------------------------------------------------------------------------------------------------------------
// The protocol

#[test]
fn reads_the_info_of_a_query() {
    let channel = basic_channel(TrinoSessionDefaults::default());
    let request = channel.http_request(&TrinoRequest::FetchQueryInfo { query_id: "q1".into() }).unwrap();
    assert_eq!(
        (request.url.as_str(), request.method.clone()),
        ("https://trino.example.com/v1/query/q1", HttpMethod::Get)
    );
    assert_eq!(request.header("X-Trino-User"), Some("user"));
    let info = read_query_info(&HttpResponse::new(200, r#"{"queryId":"q1","state":"FINISHED"}"#)).unwrap();
    assert_eq!(info["state"], "FINISHED");
}

#[test]
fn encodes_the_id_of_a_query_in_its_info_uri() {
    let channel = basic_channel(TrinoSessionDefaults::default());
    let request = channel.http_request(&TrinoRequest::FetchQueryInfo { query_id: "a/b c".into() }).unwrap();
    assert_eq!(request.url, "https://trino.example.com/v1/query/a%2Fb%20c");
}

#[test]
fn asks_executing_queries_for_large_result_pages() {
    let channel = basic_channel(TrinoSessionDefaults::default());
    let url = |uri: &str| channel.http_request(&TrinoRequest::FetchResults { next_uri: uri.into() }).unwrap().url;
    assert_eq!(
        url("https://trino.example.com/v1/statement/queued/q1/y1/1"),
        "https://trino.example.com/v1/statement/queued/q1/y1/1"
    );
    assert_eq!(
        url("https://trino.example.com/v1/statement/executing/q1/y2/2"),
        format!("https://trino.example.com/v1/statement/executing/q1/y2/2?targetResultSize={TARGET_RESULT_SIZE}")
    );
    // A next URI that is no URL fails before it is sent
    let error = channel.http_request(&TrinoRequest::FetchResults { next_uri: "next-1".into() }).unwrap_err();
    assert_eq!(error.kind, TrinoErrorKind::Protocol);
}

#[test]
fn sets_query_params_like_url_search_params() {
    assert_eq!(set_query_param("https://h/p?a=1&t=2#f", "t", "32MB").as_deref(), Some("https://h/p?a=1&t=32MB#f"));
    assert_eq!(set_query_param("https://h", "t", "a b").as_deref(), Some("https://h?t=a+b"));
    assert_eq!(set_query_param("/relative", "t", "1"), None);
    assert_eq!(form_encode([("a", "x y/z"), ("b", "ä*-._~")]), "a=x+y%2Fz&b=%C3%A4*-._%7E");
}

#[test]
fn retries_rejected_and_failed_requests_of_query_results() {
    let policy = TrinoRetryPolicy { attempts: 4, initial_delay_ms: 0, max_delay_ms: 0 };
    let read = |outcome: FetchOutcome, attempt| read_result_page(&outcome, attempt, &policy);
    assert_eq!(read(FetchOutcome::Response(status_response(503, "")), 1), ResultPageOutcome::Retry { delay_ms: 0 });
    assert_eq!(read(FetchOutcome::NetworkError("Failed to fetch".into()), 2), ResultPageOutcome::Retry { delay_ms: 0 });
    assert_eq!(read(FetchOutcome::Response(status_response(502, "")), 3), ResultPageOutcome::Retry { delay_ms: 0 });
    let ResultPageOutcome::Page(page) = read(json_response(json!({ "id": "q1", "data": [[1]] })), 4) else {
        panic!("expected a page");
    };
    assert_eq!((page.id.as_str(), page.data), ("q1", Some(vec![json!([1])])));
}

#[test]
fn gives_up_on_query_results_after_the_last_attempt_and_on_other_errors() {
    let policy = TrinoRetryPolicy { attempts: 2, initial_delay_ms: 0, max_delay_ms: 0 };
    let ResultPageOutcome::Failed(error) =
        read_result_page(&FetchOutcome::Response(status_response(504, "")), 2, &policy)
    else {
        panic!("expected a failure");
    };
    assert_eq!(error.data.get("status").map(String::as_str), Some("504"));
    let policy = TrinoRetryPolicy { attempts: 5, ..policy };
    let ResultPageOutcome::Failed(error) =
        read_result_page(&FetchOutcome::Response(status_response(404, "")), 1, &policy)
    else {
        panic!("expected a failure");
    };
    assert_eq!(
        (error.message.as_str(), error.kind),
        ("Failed to fetch query results", TrinoErrorKind::Http { status: 404 })
    );
    let ResultPageOutcome::Failed(error) = read_result_page(&FetchOutcome::NetworkError("down".into()), 5, &policy)
    else {
        panic!("expected a failure");
    };
    assert_eq!(error.kind, TrinoErrorKind::Network);
}

#[test]
fn doubles_the_delay_of_retries_up_to_the_maximum() {
    let policy = TrinoRetryPolicy { attempts: 10, initial_delay_ms: 10, max_delay_ms: 50 };
    let delays: Vec<u64> = (1..=5).map(|attempt| policy.delay_ms(attempt)).collect();
    assert_eq!(delays, [10, 20, 40, 50, 50]);
    assert_eq!(policy.delay_ms(200), policy.max_delay_ms);
}

#[test]
fn parses_integers_beyond_the_safe_integers_exactly() {
    let parsed = parse_trino_json(br#"{"data":[[9007199254740993, 1e20, 2, "1234567890123456"]]}"#).unwrap();
    let row = &parsed["data"][0];
    assert_eq!(row[0].as_i64(), Some(9_007_199_254_740_993));
    assert_eq!(row[1].as_f64(), Some(1e20));
    assert_eq!(row[2].as_i64(), Some(2));
    assert_eq!(row[3], "1234567890123456");
}

#[test]
fn cancels_a_query_by_deleting_its_next_uri() {
    let channel = basic_channel(TrinoSessionDefaults::default());
    let request = channel.http_request(&TrinoRequest::CancelQuery { next_uri: NEXT_URI.into() }).unwrap();
    assert_eq!((request.url.as_str(), request.method.clone()), (NEXT_URI, HttpMethod::Delete));
    assert_eq!(read_cancel_response(&FetchOutcome::Response(HttpResponse::new(204, ""))), Ok(()));
}

#[test]
fn fails_on_rejected_requests() {
    let not_found = status_response(404, "Not Found");
    let error = read_query_info(&not_found).unwrap_err();
    assert_eq!(error.message, "Failed to fetch query info");
    assert_eq!(error.data.get("status").map(String::as_str), Some("404"));
    assert_eq!(error.data.get("message").map(String::as_str), Some("Not Found"));
    let error = read_cancel_response(&FetchOutcome::Response(not_found)).unwrap_err();
    assert_eq!(error.message, "Cancelling a query failed");
    let error = read_statement_response(&status_response(403, "Forbidden")).unwrap_err();
    assert_eq!(error.message, "Query failed");
    assert_eq!(error.to_detailed_error().data.get("message").map(String::as_str), Some("Forbidden"));
}

#[test]
fn posts_the_statement_with_basic_auth_and_without_defaults() {
    let channel = basic_channel(TrinoSessionDefaults::default());
    let request = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
    assert_eq!(
        (request.url.as_str(), request.method.clone()),
        ("https://trino.example.com/v1/statement", HttpMethod::Post)
    );
    assert_eq!(request.body.as_deref(), Some("select 1"));
    assert_eq!(request.header("X-Trino-Catalog"), None);
    assert_eq!(request.header("X-Trino-Schema"), None);
    assert_eq!(request.header("X-Trino-User"), Some("user"));
    assert_eq!(request.header("Authorization"), Some(format!("Basic {}", base64_encode(b"user:secret")).as_str()));
    assert_eq!(base64_encode(b"user:secret"), "dXNlcjpzZWNyZXQ=");
}

#[test]
fn sends_the_default_catalog_and_schema() {
    let session = |catalog: Option<&str>, schema: Option<&str>| {
        let channel =
            basic_channel(TrinoSessionDefaults { catalog: catalog.map(Into::into), schema: schema.map(Into::into) });
        let request = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
        (request.header("X-Trino-Catalog").map(str::to_string), request.header("X-Trino-Schema").map(str::to_string))
    };
    assert_eq!(session(Some("hive"), Some("sales")), (Some("hive".into()), Some("sales".into())));
    assert_eq!(session(Some("hive"), None), (Some("hive".into()), None));
    // The defaults of params: a schema needs a catalog
    let channel = TrinoChannel::from_params(&object(json!({ "endpoint": ENDPOINT, "defaultSchema": "sales" })));
    assert_eq!(channel.defaults, TrinoSessionDefaults::default());
    // Without auth, a channel sends no credentials
    let request = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
    assert!(request.headers.is_empty());
}

/// A channel with OAuth and a token that expires at a time
fn oauth_channel(expires_at: Option<i64>) -> TrinoChannel {
    let params = object(json!({
        "endpoint": ENDPOINT,
        "auth": {
            "authType": "AUTH_OAUTH",
            "oauth": { "authorizationUrl": "https://idp/auth", "tokenUrl": "https://idp/token", "clientId": "dashql", "callbackUrl": "" },
        },
    }));
    let mut channel = TrinoChannel::from_params(&params);
    channel.access_token = Some(TrinoAccessToken {
        created_at: 0,
        access_token: "token-1".into(),
        token_type: "Bearer".into(),
        refresh_token: Some("refresh-1".into()),
        expires_at,
        scope: None,
        principal: None,
    });
    channel
}

#[test]
fn sends_the_oauth_token_and_refreshes_it_before_it_expires() {
    let mut channel = oauth_channel(Some(1_000_000));
    let request = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
    assert_eq!(request.header("Authorization"), Some("Bearer token-1"));
    assert_eq!(request.header("X-Trino-User"), None);

    // Long before the expiry nothing happens, within the margin before it the token is refreshed once
    let margin = 1_000_000 - ACCESS_TOKEN_REFRESH_MARGIN_MS;
    assert_eq!(channel.begin_token_refresh(margin - 1), TokenRefresh::NotNeeded);
    let TokenRefresh::Started(refresh) = channel.begin_token_refresh(margin) else {
        panic!("expected a refresh");
    };
    assert_eq!((refresh.url.as_str(), refresh.method.clone()), ("https://idp/token", HttpMethod::Post));
    assert_eq!(refresh.header("Content-Type"), Some("application/x-www-form-urlencoded"));
    assert_eq!(refresh.body.as_deref(), Some("grant_type=refresh_token&client_id=dashql&refresh_token=refresh-1"));
    assert_eq!(channel.begin_token_refresh(margin), TokenRefresh::Pending);

    // The new token keeps the refresh token since the server sent none
    let refreshed = json_response(json!({ "access_token": "token-2", "expires_in": 3600 }));
    channel.finish_token_refresh(&refreshed, 2_000_000).unwrap();
    let token = channel.access_token.clone().unwrap();
    assert_eq!(
        (token.access_token.as_str(), token.refresh_token.as_deref(), token.expires_at, token.token_type.as_str()),
        ("token-2", Some("refresh-1"), Some(2_000_000 + 3_600_000), "Bearer")
    );
    let request = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
    assert_eq!(request.header("Authorization"), Some("Bearer token-2"));

    // A token without expiry is never refreshed
    assert_eq!(oauth_channel(None).begin_token_refresh(i64::MAX), TokenRefresh::NotNeeded);
}

#[test]
fn reads_token_responses() {
    // A body that is no JSON object may echo anything, it is left out
    let failed = FetchOutcome::Response(HttpResponse::new(400, "invalid_grant"));
    let error = read_token_response(&failed, 0).unwrap_err();
    assert_eq!(error.message, "Token request failed: 400");
    let missing = read_token_response(&json_response(json!({ "token_type": "Bearer" })), 0).unwrap_err();
    assert_eq!(missing.kind, TrinoErrorKind::Protocol);
    let token = read_token_response(
        &json_response(json!({ "access_token": "a", "token_type": "", "refresh_token": "r", "scope": "openid" })),
        5_000,
    )
    .unwrap();
    assert_eq!(token.token_type, "Bearer");
    assert_eq!(token.expires_at, None);
    // The JSON of the connection schema reads back
    assert_eq!(
        token.to_json(),
        json!({ "createdAt": "1970-01-01T00:00:05.000Z", "accessToken": "a", "tokenType": "Bearer", "refreshToken": "r", "scope": "openid" })
    );
    assert_eq!(TrinoAccessToken::from_json(&token.to_json()), Some(token));
}

#[test]
fn encodes_and_decodes_base64_like_btoa_and_atob() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"\x01"), "AQ==");
    assert_eq!(base64_encode(b"\x01\x02"), "AQI=");
    assert_eq!(base64_decode("AQI="), Some(vec![1, 2]));
    assert_eq!(base64_decode("AQI"), Some(vec![1, 2]));
    assert_eq!(base64_decode(" AQ I= \n"), Some(vec![1, 2]));
    assert_eq!(base64_decode("A"), None);
    assert_eq!(base64_decode("A*=="), None);
}

// ---------------------------------------------------------------------------------------------------------------------
// The conversion to Arrow

/// Berlin and New York in 2024, enough for the tests of named zones
struct FakeZones;

impl TimeZoneOffsets for FakeZones {
    fn offset_ms(&self, zone: &str, instant: i64) -> Option<i64> {
        const HOUR: i64 = 3_600_000;
        let utc = |month: u32, day: u32, hour: i64| {
            let days_before_month = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
            let days = 19_723 + days_before_month[(month - 1) as usize] + i64::from(day) - 1;
            days * 86_400_000 + hour * HOUR
        };
        match zone {
            // Summer time from the last Sunday of March to the last Sunday of October, at 01:00 UTC
            "Europe/Berlin" => Some(if (utc(3, 31, 1)..utc(10, 27, 1)).contains(&instant) { 2 * HOUR } else { HOUR }),
            // Daylight saving time from the second Sunday of March to the first Sunday of November
            "America/New_York" => {
                Some(if (utc(3, 10, 7)..utc(11, 3, 6)).contains(&instant) { -4 * HOUR } else { -5 * HOUR })
            }
            _ => None,
        }
    }
}

/// Milliseconds since epoch of a time in UTC
fn utc(year: i64, month: i64, day: i64, hours: i64, minutes: i64, seconds: i64, ms: i64) -> i64 {
    dashql_core_runtime::time::utc_ms(year, month, day, hours, minutes, seconds, ms).unwrap()
}

/// Translate the values of a single column of a type
fn translate_column(data_type: DataType, values: Vec<Value>) -> RecordBatch {
    let schema: SchemaRef = Arc::new(Schema::new(vec![Field::new("c", data_type, true)]));
    let rows: Vec<Value> = values.into_iter().map(|value| json!([value])).collect();
    rows_to_record_batch(&schema, &rows, &FakeZones).unwrap()
}

/// The values of a primitive column, none for nulls
fn primitive<T: arrow_array::ArrowPrimitiveType>(batch: &RecordBatch) -> Vec<Option<T::Native>> {
    batch.column(0).as_primitive::<T>().iter().collect()
}

#[test]
fn translates_the_values_of_every_column_type() {
    let booleans = translate_column(
        DataType::Boolean,
        vec![json!(true), json!(0), Value::Null, json!(""), json!("false"), json!([])],
    );
    let booleans: Vec<Option<bool>> = booleans.column(0).as_boolean().iter().collect();
    assert_eq!(booleans, [Some(true), Some(false), None, Some(false), Some(true), Some(true)]);

    assert_eq!(
        primitive::<Int8Type>(&translate_column(DataType::Int8, vec![json!(-3), json!("5"), json!(300)])),
        [Some(-3), Some(5), Some(44)]
    );
    assert_eq!(
        primitive::<Int16Type>(&translate_column(DataType::Int16, vec![json!(-30000), json!("0x10")])),
        [Some(-30000), Some(16)]
    );
    assert_eq!(
        primitive::<Int32Type>(&translate_column(
            DataType::Int32,
            vec![
                json!(1),
                json!("42"),
                json!(""),
                Value::Null,
                json!("abc"),
                json!(" 7 "),
                json!(1.9),
                json!("4294967297"),
                json!("1e3")
            ]
        )),
        [Some(1), Some(42), None, None, None, Some(7), Some(1), Some(1), Some(1000)]
    );
    assert_eq!(
        primitive::<Int64Type>(&translate_column(
            DataType::Int64,
            vec![
                json!("9007199254740993"),
                json!(2),
                json!("1.5"),
                json!(""),
                json!(9_007_199_254_740_993_i64),
                json!("18446744073709551617"),
                json!(true),
                json!(1.5)
            ]
        )),
        [Some(9_007_199_254_740_993), Some(2), None, None, Some(9_007_199_254_740_993), Some(1), Some(1), None]
    );
    assert_eq!(
        primitive::<Float32Type>(&translate_column(DataType::Float32, vec![json!(1.5), json!("x")])),
        [Some(1.5), None]
    );
    assert_eq!(
        primitive::<Float64Type>(&translate_column(
            DataType::Float64,
            vec![json!(1.5), json!("2.25"), json!("x"), Value::Null, json!("Infinity"), json!("inf")]
        )),
        [Some(1.5), Some(2.25), None, None, Some(f64::INFINITY), None]
    );
    assert_eq!(
        primitive::<Date32Type>(&translate_column(
            DataType::Date32,
            vec![json!("2024-02-29"), json!("not a date"), Value::Null, json!("2023-02-29"), json!("1969-12-31")]
        )),
        [Some((utc(2024, 2, 29, 0, 0, 0, 0) / 86_400_000) as i32), None, None, None, Some(-1)]
    );
    assert_eq!(
        primitive::<Date64Type>(&translate_column(DataType::Date64, vec![json!("1970-01-02"), json!("")])),
        [Some(86_400_000), None]
    );
    assert_eq!(
        primitive::<Time32MillisecondType>(&translate_column(
            DataType::Time32(TimeUnit::Millisecond),
            vec![
                json!("01:02:03.456"),
                json!("12:30"),
                json!("00:00:00.5"),
                Value::Null,
                json!("01:02:03.456+01:00"),
                json!(""),
                json!("00:00:00.x")
            ]
        )),
        [Some(3_723_456), Some(45_000_000), Some(500), None, Some(3_723_456), Some(0), Some(0)]
    );
    let timestamps = translate_column(
        DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into())),
        vec![json!("2024-01-02 03:04:05.678Z"), json!("never"), json!("")],
    );
    assert_eq!(
        timestamps.schema().field(0).data_type(),
        &DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into()))
    );
    assert_eq!(primitive::<TimestampMillisecondType>(&timestamps), [Some(utc(2024, 1, 2, 3, 4, 5, 678)), None, None]);
    let wall_clock = translate_column(
        DataType::Timestamp(TimeUnit::Millisecond, None),
        vec![json!("2024-01-02 03:04:05.678"), json!("")],
    );
    assert_eq!(primitive::<TimestampMillisecondType>(&wall_clock), [Some(utc(2024, 1, 2, 3, 4, 5, 678)), None]);

    let binaries =
        translate_column(DataType::Binary, vec![json!(base64_encode(&[1, 2])), json!(42), json!("not base64!")]);
    let binaries: Vec<Option<&[u8]>> = binaries.column(0).as_binary::<i32>().iter().collect();
    assert_eq!(binaries, [Some(&[1u8, 2][..]), None, None]);

    let strings = translate_column(
        DataType::Utf8,
        vec![
            json!("äö"),
            json!(3),
            json!({ "a": [1] }),
            Value::Null,
            json!(1.0),
            json!([1.5, 1e21, "x"]),
            json!(false),
        ],
    );
    let strings: Vec<Option<&str>> = strings.column(0).as_string::<i32>().iter().collect();
    assert_eq!(
        strings,
        [Some("äö"), Some("3"), Some(r#"{"a":[1]}"#), None, Some("1"), Some(r#"[1.5,1e+21,"x"]"#), Some("false")]
    );
}

#[test]
fn translates_decimals_into_unscaled_values_and_drops_values_that_do_not_fit() {
    let too_large = (1i128 << 126).to_string() + "0";
    let batch = translate_column(
        DataType::Decimal128(38, 2),
        vec![
            json!("12.34"),
            json!("-0.5"),
            json!(".25"),
            json!(12.5),
            json!("1.234"),
            json!("."),
            json!(too_large),
            json!(" 7 "),
            json!("5."),
        ],
    );
    let values: Vec<Option<i128>> = batch.column(0).as_primitive::<Decimal128Type>().iter().collect();
    assert_eq!(values, [Some(1234), Some(-50), Some(25), Some(1250), None, None, None, Some(700), Some(500)]);
}

#[test]
fn translates_columns_of_types_without_translation_into_json_strings() {
    let batch =
        translate_column(DataType::List(Arc::new(Field::new("item", DataType::Int32, true))), vec![json!([1, 2])]);
    assert_eq!(batch.schema().field(0).data_type(), &DataType::Utf8);
    assert_eq!(batch.column(0).as_string::<i32>().value(0), "[1,2]");
}

#[test]
fn translates_rows_that_lack_columns_into_nulls() {
    let schema =
        Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, true), Field::new("b", DataType::Utf8, true)]));
    let batch = rows_to_record_batch(&schema, &[json!([1]), json!("no row"), json!([2, "x"])], &FakeZones).unwrap();
    assert_eq!(primitive::<Int32Type>(&batch), [Some(1), None, Some(2)]);
    assert_eq!(batch.column(1).null_count(), 2);
    // A page without columns keeps its rows
    let empty = rows_to_record_batch(&Arc::new(Schema::empty()), &[json!([]), json!([])], &FakeZones).unwrap();
    assert_eq!(empty.num_rows(), 2);
}

#[test]
fn parses_trino_timestamps() {
    let cases: [(&str, Option<i64>); 15] = [
        ("2024-03-01 12:30:00.123", Some(utc(2024, 3, 1, 12, 30, 0, 123))),
        ("2024-03-01 12:30:00.123456789", Some(utc(2024, 3, 1, 12, 30, 0, 123))),
        ("2024-03-01 12:30:00", Some(utc(2024, 3, 1, 12, 30, 0, 0))),
        ("0050-03-01 12:30:00.000", Some(-60_584_153_400_000)),
        ("2024-03-01 12:30:00.123 UTC", Some(utc(2024, 3, 1, 12, 30, 0, 123))),
        ("2024-03-01 12:30:00.000 +01:00", Some(utc(2024, 3, 1, 11, 30, 0, 0))),
        ("2024-03-01 12:30:00.000 -05:30", Some(utc(2024, 3, 1, 18, 0, 0, 0))),
        ("2024-01-15 12:00:00.000 Europe/Berlin", Some(utc(2024, 1, 15, 11, 0, 0, 0))),
        ("2024-07-15 12:00:00.000 Europe/Berlin", Some(utc(2024, 7, 15, 10, 0, 0, 0))),
        ("2024-07-15 12:00:00.000 America/New_York", Some(utc(2024, 7, 15, 16, 0, 0, 0))),
        ("2024-03-31 03:30:00.000 Europe/Berlin", Some(utc(2024, 3, 31, 1, 30, 0, 0))),
        ("2024-03-01 12:30:00.000 Mars/Olympus", None),
        ("yesterday", None),
        ("2024-03-01 12:30:00.123 ", None),
        ("-0001-01-01 00:00:00", Some(utc(-1, 1, 1, 0, 0, 0, 0))),
    ];
    for (text, expected) in cases {
        assert_eq!(parse_trino_timestamp_ms(text, &FakeZones), expected, "{text}");
    }
    // Without zone offsets of the host, a named zone is unknown
    assert_eq!(
        parse_trino_timestamp_ms("2024-01-15 12:00:00.000 Europe/Berlin", &dashql_core_runtime::trino::NoTimeZones),
        None
    );
}

#[test]
fn writes_numbers_like_javascript() {
    let cases: [(f64, &str); 12] = [
        (1.0, "1"),
        (-1.5, "-1.5"),
        (0.1, "0.1"),
        (1e21, "1e+21"),
        (1.5e21, "1.5e+21"),
        (123_456_789_012_345_680_000.0, "123456789012345680000"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1.25e-7, "1.25e-7"),
        (5e-324, "5e-324"),
        (-0.0, "0"),
        (406_181.0111, "406181.0111"),
    ];
    for (number, text) in cases {
        assert_eq!(js_number_string(number), text);
    }
}

#[test]
fn translates_every_trino_type() {
    let cases: [(&str, DataType); 27] = [
        ("boolean", DataType::Boolean),
        ("tinyint", DataType::Int8),
        ("smallint", DataType::Int16),
        ("integer", DataType::Int32),
        ("bigint", DataType::Int64),
        ("real", DataType::Float32),
        ("double", DataType::Float64),
        ("decimal(10, 2)", DataType::Decimal128(10, 2)),
        ("decimal(21,1)", DataType::Decimal128(21, 1)),
        ("decimal", DataType::Decimal128(38, 0)),
        ("varchar", DataType::Utf8),
        ("varchar(20)", DataType::Utf8),
        ("char(3)", DataType::Utf8),
        ("varbinary", DataType::Binary),
        ("json", DataType::Utf8),
        ("date", DataType::Date32),
        ("time(3)", DataType::Time32(TimeUnit::Millisecond)),
        ("time(3) with time zone", DataType::Time32(TimeUnit::Millisecond)),
        ("timestamp(3)", DataType::Timestamp(TimeUnit::Millisecond, None)),
        ("timestamp(6) with time zone", DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into()))),
        ("interval day to second", DataType::Utf8),
        ("uuid", DataType::Utf8),
        ("ipaddress", DataType::Utf8),
        ("array(integer)", DataType::Utf8),
        ("map(varchar, bigint)", DataType::Utf8),
        ("row(a integer)", DataType::Utf8),
        ("hyperloglog", DataType::Utf8),
    ];
    for (type_name, expected) in &cases {
        assert_eq!(&parse_trino_type(type_name), expected, "{type_name}");
    }
    assert_eq!(parse_trino_type(" BIGINT "), DataType::Int64);
    assert_eq!(parse_trino_type("decimal(40, 2)"), DataType::Utf8);

    // A row of every type, as Trino writes the values
    let columns: Vec<TrinoColumn> = cases
        .iter()
        .enumerate()
        .map(|(i, (type_name, _))| TrinoColumn { name: format!("c{i}"), type_name: type_name.to_string() })
        .collect();
    let schema = dashql_core_runtime::trino::trino_schema(&columns);
    let row = json!([
        true, 7, 300, 70000, 9_007_199_254_740_993_i64, 1.5, 2.25, "12.34", "-12.5", "42", "text", "a", "abc",
        base64_encode(b"bytes"), "{\"a\":1}", "2024-02-29", "01:02:03.456", "01:02:03.456+01:00",
        "2024-03-01 12:30:00.123", "2024-03-01 12:30:00.123456 Europe/Berlin", "1 02:03:04.000",
        "d1f9f0b2-0a4e-4b8e-9f4e-8f8f8f8f8f8f", "192.168.0.1", [1, 2], { "k": 3 }, [1, "x"], "AgwBAA=="
    ]);
    let batch =
        rows_to_record_batch(&schema, &[row, Value::Array(vec![Value::Null; cases.len()])], &FakeZones).unwrap();
    assert_eq!(batch.num_rows(), 2);
    for (i, (_, expected)) in cases.iter().enumerate() {
        assert_eq!(batch.column(i).data_type(), expected, "column {i}");
        assert!(batch.column(i).is_valid(0), "column {i}");
        assert!(batch.column(i).is_null(1), "column {i}");
    }
    let column = |i: usize| batch.column(i);
    assert!(column(0).as_boolean().value(0));
    assert_eq!(column(1).as_primitive::<Int8Type>().value(0), 7);
    assert_eq!(column(2).as_primitive::<Int16Type>().value(0), 300);
    assert_eq!(column(3).as_primitive::<Int32Type>().value(0), 70000);
    assert_eq!(column(4).as_primitive::<Int64Type>().value(0), 9_007_199_254_740_993);
    assert_eq!(column(5).as_primitive::<Float32Type>().value(0), 1.5);
    assert_eq!(column(6).as_primitive::<Float64Type>().value(0), 2.25);
    assert_eq!(column(7).as_primitive::<Decimal128Type>().value(0), 1234);
    assert_eq!(column(8).as_primitive::<Decimal128Type>().value(0), -125);
    assert_eq!(column(9).as_primitive::<Decimal128Type>().value(0), 42);
    assert_eq!(column(13).as_binary::<i32>().value(0), b"bytes");
    assert_eq!(column(14).as_string::<i32>().value(0), "{\"a\":1}");
    assert_eq!(column(15).as_primitive::<Date32Type>().value(0), (utc(2024, 2, 29, 0, 0, 0, 0) / 86_400_000) as i32);
    assert_eq!(column(16).as_primitive::<Time32MillisecondType>().value(0), 3_723_456);
    assert_eq!(column(18).as_primitive::<TimestampMillisecondType>().value(0), utc(2024, 3, 1, 12, 30, 0, 123));
    assert_eq!(column(19).as_primitive::<TimestampMillisecondType>().value(0), utc(2024, 3, 1, 11, 30, 0, 123));
    assert_eq!(column(23).as_string::<i32>().value(0), "[1,2]");
    assert_eq!(column(24).as_string::<i32>().value(0), r#"{"k":3}"#);
    assert_eq!(column(25).as_string::<i32>().value(0), r#"[1,"x"]"#);
}

// ---------------------------------------------------------------------------------------------------------------------
// The query

/// A query whose requests are answered from queues, with a fake clock for its timers
struct Harness {
    /// The query
    query: TrinoQuery,
    /// The time
    now: i64,
    /// The answers of the statement and the pages, in order. A page request waits while there is none.
    pages: VecDeque<FetchOutcome>,
    /// The answers of QueryInfo requests, in order, the last one repeats
    infos: VecDeque<FetchOutcome>,
    /// The requests that wait for an answer
    pending: VecDeque<(RequestId, TrinoRequest)>,
    /// The running timers with the time they fire at
    timers: Vec<(TimerId, i64)>,
    /// All requests in the order they were sent
    requests: Vec<TrinoRequest>,
    /// Everything else the query reported
    outputs: Vec<StreamOutput>,
}

impl Harness {
    /// A query of a statement
    fn new(options: TrinoQueryOptions) -> Self {
        let (query, out) = TrinoQuery::start("select 1", options, 0);
        let mut harness = Self {
            query,
            now: 0,
            pages: VecDeque::new(),
            infos: VecDeque::new(),
            pending: VecDeque::new(),
            timers: Vec::new(),
            requests: Vec::new(),
            outputs: Vec::new(),
        };
        harness.absorb(out);
        harness
    }

    /// A query whose statement and pages are answered with results
    fn with_pages(pages: Vec<Value>) -> Self {
        let mut harness = Self::new(TrinoQueryOptions::default());
        harness.pages.extend(pages.into_iter().map(json_response));
        harness
    }

    /// Take what the query reported
    fn absorb(&mut self, out: Vec<StreamOutput>) {
        for output in out {
            match output {
                StreamOutput::Send { id, request } => {
                    self.requests.push(request.clone());
                    self.pending.push_back((id, request));
                }
                StreamOutput::StartTimer { id, delay_ms } => self.timers.push((id, self.now + delay_ms as i64)),
                StreamOutput::ClearTimer { id } => self.timers.retain(|(timer, _)| *timer != id),
                other => self.outputs.push(other),
            }
        }
    }

    /// Answer a request that can be answered, false if there is none
    fn answer_one(&mut self) -> bool {
        let position = self.pending.iter().position(|(_, request)| match request {
            TrinoRequest::SubmitStatement { .. } | TrinoRequest::FetchResults { .. } => !self.pages.is_empty(),
            _ => !self.infos.is_empty(),
        });
        let Some((id, request)) = position.and_then(|position| self.pending.remove(position)) else {
            return false;
        };
        let outcome = match request {
            TrinoRequest::SubmitStatement { .. } | TrinoRequest::FetchResults { .. } => self.pages.pop_front(),
            _ if self.infos.len() > 1 => self.infos.pop_front(),
            _ => self.infos.front().cloned(),
        };
        let Some(outcome) = outcome else {
            return false;
        };
        let out = self.query.on_response(id, &outcome, self.now);
        self.absorb(out);
        true
    }

    /// Answer requests until none can be answered
    fn run(&mut self) {
        while self.answer_one() {}
    }

    /// Advance the clock, the due timers fire in order and the requests are answered after each
    fn advance(&mut self, ms: i64) {
        let until = self.now + ms;
        self.run();
        loop {
            self.timers.sort_by_key(|(id, at)| (*at, *id));
            let Some(&(id, at)) = self.timers.first().filter(|(_, at)| *at <= until) else {
                break;
            };
            self.timers.remove(0);
            self.now = at;
            let out = self.query.on_timer(id, self.now);
            self.absorb(out);
            self.run();
        }
        self.now = until;
    }

    /// The batches that the query reported
    fn batches(&self) -> Vec<&RecordBatch> {
        self.outputs
            .iter()
            .filter_map(|output| if let StreamOutput::Batch(batch) = output { Some(batch) } else { None })
            .collect()
    }

    /// The kinds of the engine progress that the query reported
    fn progress_kinds(&self) -> Vec<&'static str> {
        self.outputs
            .iter()
            .filter_map(|output| match output {
                StreamOutput::Progress(progress) => Some(match &progress.engine_progress {
                    Some(EngineProgressPayload::TrinoStatementStats { .. }) => "trino_statement_stats",
                    Some(EngineProgressPayload::TrinoQueryInfo { .. }) => "trino_query_info",
                    Some(EngineProgressPayload::TrinoQueryInfoStats { .. }) => "trino_query_info_stats",
                    _ => "none",
                }),
                _ => None,
            })
            .collect()
    }

    /// The QueryInfo requests
    fn query_info_requests(&self) -> usize {
        self.requests.iter().filter(|request| matches!(request, TrinoRequest::FetchQueryInfo { .. })).count()
    }

    /// The next URIs that were fetched
    fn fetched_uris(&self) -> Vec<&str> {
        self.requests
            .iter()
            .filter_map(|request| match request {
                TrinoRequest::FetchResults { next_uri } => Some(next_uri.as_str()),
                _ => None,
            })
            .collect()
    }

    /// How the query ended
    fn end(&self) -> Option<&StreamOutput> {
        self.outputs.iter().rev().find(|output| matches!(output, StreamOutput::Finished | StreamOutput::Failed(_)))
    }
}

const COLUMNS: &str = r#"[{ "name": "customer_id", "type": "bigint" }]"#;

/// A response of `/v1/statement` with an id
fn page(mut fields: Value) -> Value {
    fields["id"] = json!("query-id");
    fields
}

/// The statistics of a query in a state
fn state(name: &str) -> Value {
    json!({ "state": name })
}

/// The next URI of a page
fn next(n: u32) -> String {
    format!("https://example.com/v1/statement/executing/query-id/y/{n}")
}

/// The statistics of a running query with a tree of stages in states
fn stages(states: &[&str]) -> Value {
    let children: Vec<Value> = states
        .iter()
        .skip(1)
        .enumerate()
        .map(|(i, state)| json!({ "stageId": (i + 1).to_string(), "state": state, "subStages": [] }))
        .collect();
    json!({ "state": "RUNNING", "rootStage": { "stageId": "0", "state": states[0], "subStages": children } })
}

#[test]
fn publishes_the_progress_of_the_statement_and_of_every_poll_with_the_raw_statistics() {
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": { "state": "QUEUED", "queued": true }, "nextUri": next(1) })),
        page(json!({ "stats": state("RUNNING"), "nextUri": next(2) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.run();
    let progress: Vec<(Option<String>, Option<bool>)> = harness
        .outputs
        .iter()
        .filter_map(|output| match output {
            StreamOutput::Progress(progress) => Some((progress.phase.clone(), progress.is_queued)),
            _ => None,
        })
        .collect();
    assert_eq!(
        progress,
        [(Some("QUEUED".into()), Some(true)), (Some("RUNNING".into()), None), (Some("FINISHED".into()), None)]
    );
    assert_eq!(harness.progress_kinds(), ["trino_statement_stats"; 3]);
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
}

#[test]
fn requests_the_plans_of_the_stages_once_the_stages_exist() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0" } });
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": state("QUEUED"), "nextUri": next(1) })),
        page(json!({ "stats": running, "nextUri": next(2) })),
        page(json!({ "stats": running, "nextUri": next(3) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.infos.push_back(json_response(
        json!({ "queryId": "query-id", "state": "FINISHED", "finalQueryInfo": true, "stages": { "stages": [] } }),
    ));
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    harness.run();
    // The plans once, and the final QueryInfo of the finished query before the stream ends
    let kinds = harness.progress_kinds();
    assert!(kinds.contains(&"trino_query_info"));
    assert_eq!(kinds.last(), Some(&"trino_query_info_stats"));
    assert_eq!(harness.query_info_requests(), 2);
    assert!(harness.requests.iter().all(|request| match request {
        TrinoRequest::FetchQueryInfo { query_id } => query_id == "query-id",
        _ => true,
    }));
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
}

#[test]
fn fetches_the_query_info_again_when_the_tasks_of_more_stages_are_done() {
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": stages(&["RUNNING", "RUNNING", "RUNNING"]), "nextUri": next(1) })),
        page(json!({ "stats": stages(&["RUNNING", "RUNNING", "PENDING"]), "nextUri": next(2) })),
        page(json!({ "stats": stages(&["RUNNING", "RUNNING", "PENDING"]), "nextUri": next(3) })),
        page(json!({ "stats": stages(&["RUNNING", "PENDING", "PENDING"]), "nextUri": next(4) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.infos.push_back(json_response(
        json!({ "queryId": "query-id", "state": "FINISHED", "finalQueryInfo": true, "stages": { "stages": [] } }),
    ));
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    harness.run();
    // The plans, one QueryInfo per stage whose tasks are done, the final one
    let kinds = harness.progress_kinds();
    let stats = kinds.iter().filter(|kind| **kind == "trino_query_info_stats").count();
    assert_eq!(kinds.iter().filter(|kind| **kind == "trino_query_info").count(), 1);
    assert!(stats >= 2);
    assert_eq!(harness.query_info_requests(), 1 + stats);
}

#[test]
fn fetches_the_query_info_again_while_a_stage_whose_tasks_are_done_has_no_operator_summaries() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0", "state": "PENDING" } });
    let mut harness = Harness::new(TrinoQueryOptions::default());
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    harness.pages.push_back(json_response(page(json!({ "stats": running, "nextUri": next(1) }))));
    let stage = |summaries: Value| json!({ "stageId": "query-id.0", "state": "PENDING", "stageStats": { "operatorSummaries": summaries } });
    harness.infos.extend([
        json_response(json!({ "queryId": "query-id", "state": "RUNNING", "stages": { "stages": [stage(json!([]))] } })),
        json_response(json!({ "queryId": "query-id", "state": "RUNNING", "stages": { "stages": [stage(json!([{ "operatorId": 0 }]))] } })),
        json_response(json!({ "queryId": "query-id", "state": "FINISHED", "finalQueryInfo": true, "stages": { "stages": [] } })),
    ]);
    harness.run();
    assert_eq!(harness.query_info_requests(), 1);
    // The plans lack the summaries of the pending stage, one retry brings them, then no more retries
    harness.advance(QUERY_INFO_RETRY_MS as i64);
    assert_eq!(harness.query_info_requests(), 2);
    harness.advance(5 * QUERY_INFO_RETRY_MS as i64);
    assert_eq!(harness.query_info_requests(), 2);
    harness.pages.push_back(json_response(page(
        json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") }),
    )));
    harness.run();
    assert_eq!(harness.query_info_requests(), 3);
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
    assert!(harness.timers.is_empty());
}

#[test]
fn fetches_the_query_info_of_a_finished_query_until_it_is_final() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0" } });
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": running, "nextUri": next(1) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.infos.extend([
        json_response(json!({ "queryId": "query-id", "state": "RUNNING" })),
        json_response(json!({ "queryId": "query-id", "state": "FINISHED", "finalQueryInfo": false })),
        json_response(json!({ "queryId": "query-id", "state": "FINISHED", "finalQueryInfo": true })),
    ]);
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    harness.advance(QUERY_INFO_RETRY_MS as i64);
    // The plans, a QueryInfo that is not final yet, the final one
    assert_eq!(harness.query_info_requests(), 3);
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
}

#[test]
fn stops_waiting_for_the_final_query_info_after_a_deadline() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0" } });
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": running, "nextUri": next(1) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.infos.push_back(json_response(json!({ "queryId": "query-id", "state": "FINISHING" })));
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    // The query ends once the final fetch gave up, before the deadline at the latest
    let half = QUERY_INFO_FINAL_TIMEOUT_MS as i64 / 2;
    harness.advance(half);
    assert_eq!(harness.end(), None);
    harness.advance(QUERY_INFO_FINAL_TIMEOUT_MS as i64 - half);
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
    // The QueryInfo is fetched again and again until the deadline is near
    assert!(harness.query_info_requests() > 2, "{}", harness.query_info_requests());
    assert!(harness.timers.is_empty());
}

#[test]
fn fetches_no_plans_while_nobody_shows_the_profile() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0" } });
    let mut harness = Harness::with_pages(vec![
        page(json!({ "stats": running, "nextUri": next(1) })),
        page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") })),
    ]);
    harness.infos.push_back(json_response(json!({})));
    harness.run();
    assert_eq!(harness.query_info_requests(), 0);
    // Showing the profile after the stream ended fetches nothing either
    assert!(harness.query.set_profile_detail(true, 0).is_empty());
}

#[test]
fn fetches_no_more_query_info_when_the_query_fails() {
    let running = json!({ "state": "RUNNING", "rootStage": { "stageId": "0" } });
    let options = TrinoQueryOptions {
        retry_policy: TrinoRetryPolicy { attempts: 1, ..Default::default() },
        ..Default::default()
    };
    let mut harness = Harness::new(options);
    harness.pages.extend([
        json_response(page(json!({ "stats": running, "nextUri": next(1) }))),
        FetchOutcome::NetworkError("connection lost".into()),
    ]);
    harness.infos.push_back(json_response(json!({ "stages": { "stages": [{ "state": "PENDING" }] } })));
    let out = harness.query.set_profile_detail(true, 0);
    harness.absorb(out);
    harness.advance(10_000);
    let Some(StreamOutput::Failed(error)) = harness.end() else {
        panic!("expected a failure");
    };
    assert_eq!((error.kind.clone(), error.message.as_str()), (TrinoErrorKind::Network, "connection lost"));
    // The plans only, nothing after the failure
    assert_eq!(harness.query_info_requests(), 1);
}

#[test]
fn reports_the_schema_of_an_already_finished_zero_row_response() {
    let mut harness = Harness::with_pages(vec![page(
        json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "stats": state("FINISHED") }),
    )]);
    harness.run();
    let names: Vec<&str> = harness.query.schema().unwrap().fields().iter().map(|field| field.name().as_str()).collect();
    assert_eq!(names, ["customer_id"]);
    assert!(matches!(harness.outputs.first(), Some(StreamOutput::Schema(_))));
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
}

#[test]
fn follows_the_next_uris_until_the_query_finished_and_translates_the_data() {
    let columns: Value = serde_json::from_str(COLUMNS).unwrap();
    let mut harness = Harness::with_pages(vec![
        page(json!({ "nextUri": next(1), "stats": state("QUEUED") })),
        page(json!({ "nextUri": next(2), "columns": columns, "stats": state("RUNNING") })),
        page(json!({ "nextUri": next(3), "columns": columns, "data": [[1], [2]], "stats": state("RUNNING") })),
        page(json!({ "columns": columns, "data": [[3]], "stats": state("FINISHED") })),
    ]);
    harness.run();
    assert_eq!(harness.fetched_uris(), [next(1), next(2), next(3)]);
    let rows: Vec<Vec<Option<i64>>> = harness.batches().iter().map(|batch| primitive::<Int64Type>(batch)).collect();
    assert_eq!(rows, [vec![Some(1), Some(2)], vec![Some(3)]]);
    // The statement counts as a request
    let metrics = harness.query.metrics();
    assert_eq!(
        (
            metrics.total_query_requests_started,
            metrics.total_query_requests_succeeded,
            metrics.total_batches_received,
            metrics.total_rows_received
        ),
        (4, 4, 2, 3)
    );
}

#[test]
fn follows_the_next_uris_through_any_query_state() {
    let columns: Value = serde_json::from_str(COLUMNS).unwrap();
    let mut harness = Harness::with_pages(vec![
        page(json!({ "nextUri": next(1), "stats": state("QUEUED") })),
        page(json!({ "nextUri": next(2), "stats": state("PLANNING") })),
        page(json!({ "nextUri": next(3), "columns": columns, "data": [[1]], "stats": state("FINISHED") })),
        page(json!({ "columns": columns, "data": [[2]], "stats": state("FINISHED") })),
    ]);
    harness.run();
    assert_eq!(harness.fetched_uris(), [next(1), next(2), next(3)]);
    let rows: Vec<Vec<Option<i64>>> = harness.batches().iter().map(|batch| primitive::<Int64Type>(batch)).collect();
    assert_eq!(rows, [vec![Some(1)], vec![Some(2)]]);
}

#[test]
fn requests_the_next_page_before_producing_the_current_one() {
    let columns: Value = serde_json::from_str(COLUMNS).unwrap();
    let (mut query, out) = TrinoQuery::start("select 1", TrinoQueryOptions::default(), 0);
    let Some(StreamOutput::Send { id, .. }) = out.first() else {
        panic!("expected the statement");
    };
    let out = query.on_response(*id, &json_response(page(json!({ "nextUri": next(1), "stats": state("RUNNING") }))), 0);
    let Some(StreamOutput::Send { id, .. }) = out.iter().find(|output| matches!(output, StreamOutput::Send { .. }))
    else {
        panic!("expected the first page");
    };
    let out = query.on_response(
        *id,
        &json_response(page(
            json!({ "nextUri": next(2), "columns": columns, "data": [[1]], "stats": state("RUNNING") }),
        )),
        0,
    );
    let send = out.iter().position(|output| matches!(output, StreamOutput::Send { .. }));
    let batch = out.iter().position(|output| matches!(output, StreamOutput::Batch(_)));
    assert!(send.is_some() && batch.is_some() && send < batch);
}

#[test]
fn fails_on_query_errors() {
    let mut harness = Harness::with_pages(vec![
        page(json!({ "nextUri": next(1), "stats": state("QUEUED") })),
        page(
            json!({ "error": { "errorCode": 1, "errorName": "SYNTAX_ERROR", "errorType": "USER_ERROR", "message": "line 1" } }),
        ),
    ]);
    harness.run();
    let Some(StreamOutput::Failed(error)) = harness.end() else {
        panic!("expected a failure");
    };
    assert_eq!(
        (error.message.as_str(), error.kind.clone()),
        ("Query returned an error", TrinoErrorKind::Query { code: 1 })
    );
    assert_eq!(error.data.get("errorName").map(String::as_str), Some("SYNTAX_ERROR"));
    assert_eq!(error.data.get("errorMessage").map(String::as_str), Some("line 1"));
    assert!(harness.query.schema().is_none());
    assert_eq!(harness.query.metrics().total_query_requests_failed, 1);
}

#[test]
fn fails_on_data_without_a_schema() {
    let mut harness = Harness::with_pages(vec![
        page(json!({ "nextUri": next(1), "stats": state("RUNNING") })),
        page(json!({ "data": [[1]], "stats": state("FINISHED") })),
    ]);
    harness.run();
    let Some(StreamOutput::Failed(error)) = harness.end() else {
        panic!("expected a failure");
    };
    assert_eq!(error.message, "Result schema is missing");
}

#[test]
fn fails_on_statements_that_trino_rejects() {
    let mut harness = Harness::new(TrinoQueryOptions::default());
    harness.pages.push_back(FetchOutcome::Response(status_response(403, "Forbidden")));
    harness.run();
    let Some(StreamOutput::Failed(error)) = harness.end() else {
        panic!("expected a failure");
    };
    assert_eq!((error.message.as_str(), error.data.get("status").map(String::as_str)), ("Query failed", Some("403")));
    assert_eq!(harness.query.metrics().total_query_requests_failed, 1);
}

#[test]
fn cancels_the_query_by_its_next_uri() {
    let mut harness = Harness::with_pages(vec![page(json!({ "nextUri": next(1), "stats": state("RUNNING") }))]);
    assert_eq!(harness.query.cancel_request(), None);
    harness.run();
    assert_eq!(harness.query.cancel_request(), Some(TrinoRequest::CancelQuery { next_uri: next(1) }));
    // A query without a next URI is done already
    let mut finished = Harness::with_pages(vec![page(json!({ "stats": state("FINISHED") }))]);
    finished.run();
    assert_eq!(finished.query.cancel_request(), None);
}

#[test]
fn retries_failed_pages_after_a_delay_and_stops_when_aborted() {
    let options = TrinoQueryOptions {
        retry_policy: TrinoRetryPolicy { attempts: 3, initial_delay_ms: 100, max_delay_ms: 1000 },
        ..Default::default()
    };
    let mut harness = Harness::new(options);
    harness.pages.extend([
        json_response(page(json!({ "nextUri": next(1), "stats": state("RUNNING") }))),
        FetchOutcome::Response(status_response(503, "Service Unavailable")),
        json_response(page(json!({ "columns": serde_json::from_str::<Value>(COLUMNS).unwrap(), "data": [[1]], "stats": state("FINISHED") }))),
    ]);
    harness.run();
    // The page waits for the delay
    assert_eq!(harness.fetched_uris(), [next(1)]);
    assert!(harness.outputs.iter().any(|output| matches!(output, StreamOutput::Warning { .. })));
    harness.advance(99);
    assert_eq!(harness.fetched_uris(), [next(1)]);
    harness.advance(1);
    assert_eq!(harness.fetched_uris(), [next(1), next(1)]);
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
    assert_eq!(harness.query.metrics().total_query_requests_started, 2);
    assert_eq!(harness.query.metrics().total_query_requests_succeeded, 2);

    // An aborted query clears its timer and ignores what comes later
    let mut aborted = Harness::new(options_with_attempts(3));
    aborted.pages.extend([
        json_response(page(json!({ "nextUri": next(1), "stats": state("RUNNING") }))),
        FetchOutcome::Response(status_response(503, "")),
    ]);
    aborted.run();
    assert_eq!(aborted.timers.len(), 1);
    let (timer, _) = aborted.timers[0];
    let out = aborted.query.abort();
    aborted.absorb(out);
    assert!(aborted.timers.is_empty());
    let Some(StreamOutput::Failed(error)) = aborted.end() else {
        panic!("expected an abort");
    };
    assert_eq!(error.kind, TrinoErrorKind::Aborted);
    assert!(aborted.query.on_timer(timer, 1000).is_empty());
    assert!(aborted.query.abort().is_empty());
}

/// Options with a number of attempts and no delays
fn options_with_attempts(attempts: u32) -> TrinoQueryOptions {
    TrinoQueryOptions {
        retry_policy: TrinoRetryPolicy { attempts, initial_delay_ms: 10, max_delay_ms: 10 },
        ..Default::default()
    }
}

#[test]
fn fails_a_page_whose_request_could_not_be_sent() {
    let mut harness = Harness::with_pages(vec![page(json!({ "nextUri": "next-1", "stats": state("RUNNING") }))]);
    harness.run();
    let (id, request) = harness.pending.pop_front().unwrap();
    let error = basic_channel(TrinoSessionDefaults::default()).http_request(&request).unwrap_err();
    let out = harness.query.on_request_failed(id, error, 0);
    harness.absorb(out);
    assert!(matches!(harness.end(), Some(StreamOutput::Failed(error)) if error.kind == TrinoErrorKind::Protocol));
}

/// The bodies of the statement responses of a recording of `//tests/trino:trino_recorder`
fn recorded_pages(recording: &str) -> Vec<Value> {
    let recording: Value = serde_json::from_str(recording).unwrap();
    recording["statementResponses"].as_array().unwrap().iter().map(|response| response["body"].clone()).collect()
}

#[test]
fn replays_recorded_queries() {
    let select_one = recorded_pages(include_str!("../../../tests/snapshots/profiles/trino/recordings/select_one.json"));
    let mut harness = Harness::with_pages(select_one.clone());
    harness.run();
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
    assert_eq!(harness.fetched_uris().len(), select_one.len() - 1);
    let batches = harness.batches();
    assert_eq!(batches.len(), 1);
    assert_eq!(primitive::<Int32Type>(batches[0]), [Some(1)]);
    // The progress of every response
    assert_eq!(harness.progress_kinds().len(), select_one.len());

    let q3 = recorded_pages(include_str!("../../../tests/snapshots/profiles/trino/recordings/tpch_q3_sf1.json"));
    let mut harness = Harness::with_pages(q3);
    harness.run();
    assert_eq!(harness.end(), Some(&StreamOutput::Finished));
    let schema = harness.query.schema().unwrap().clone();
    let types: Vec<&DataType> = schema.fields().iter().map(|field| field.data_type()).collect();
    assert_eq!(types, [&DataType::Int64, &DataType::Float64, &DataType::Date32, &DataType::Int32]);
    let rows: usize = harness.batches().iter().map(|batch| batch.num_rows()).sum();
    assert_eq!(rows, 10);
    let first = harness.batches()[0];
    assert_eq!(first.column(0).as_primitive::<Int64Type>().value(0), 2_456_423);
    assert_eq!(first.column(1).as_primitive::<Float64Type>().value(0), 406_181.0111);
    assert_eq!(
        first.column(2).as_primitive::<Date32Type>().value(0),
        (utc(1995, 3, 5, 0, 0, 0, 0) / 86_400_000) as i32
    );
    assert_eq!(harness.query.metrics().total_rows_received, 10);

    let failed = recorded_pages(include_str!("../../../tests/snapshots/profiles/trino/recordings/failed_cast.json"));
    let mut harness = Harness::with_pages(failed);
    harness.run();
    let Some(StreamOutput::Failed(error)) = harness.end() else {
        panic!("expected a failure");
    };
    assert_eq!(error.data.get("errorName").map(String::as_str), Some("INVALID_CAST_ARGUMENT"));
    assert_eq!(error.data.get("errorMessage").map(String::as_str), Some("Cannot cast 'ALGERIA' to INT"));
}

// ---------------------------------------------------------------------------------------------------------------------
// The descriptor

/// Trino params with OAuth
fn oauth_params() -> JsonObject {
    object(json!({
        "endpoint": ENDPOINT,
        "auth": {
            "authType": "AUTH_OAUTH",
            "oauth": { "authorizationUrl": "https://idp/auth", "tokenUrl": "https://idp/token", "clientId": "dashql", "callbackUrl": "" },
        },
    }))
}

#[test]
fn shares_params_without_secrets() {
    let params = object(json!({
        "endpoint": ENDPOINT,
        "catalogs": ["hive"],
        "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": "secret" } },
        "metadata": { "X-Token": "secret" },
    }));
    // The params of a connection to share, the live rule of the links and files
    let sanitize = |params: &JsonObject, with_login_hint: bool| {
        sanitize_connection_params_for_sharing(&json!({ "trino": params }), with_login_hint)["trino"].clone()
    };
    let shared = sanitize(&params, true);
    assert_eq!(
        shared,
        json!({ "endpoint": ENDPOINT, "catalogs": ["hive"], "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": "" } } })
    );
    let shared = sanitize(&params, false);
    assert_eq!(shared["auth"]["basic"]["username"], "");
    // OAuth params stay, params without auth get an empty one
    assert_eq!(sanitize(&oauth_params(), false), Value::Object(oauth_params()));
    assert_eq!(sanitize(&object(json!({ "endpoint": "e" })), false), json!({ "endpoint": "e", "auth": {} }));

    assert_eq!(login_hint(&params).as_deref(), Some("user"));
    assert_eq!(login_hint(&oauth_params()), None);
}

#[test]
fn reads_the_principal_of_a_token_from_its_id_token() {
    // The payload of the id token names the account, `{"sub":"alice"}`
    let id_token = format!("e30.{}.c2ln", base64_encode(br#"{"sub":"alice"}"#));
    let response = json_response(json!({ "access_token": "token-1", "id_token": id_token }));
    let token = read_token_response(&response, 0).unwrap();
    assert_eq!(token.principal.as_deref(), Some("alice"));
    // A response that names the account itself wins, one without an id token names none
    let response = json_response(json!({ "access_token": "token-1", "sub": "bob" }));
    assert_eq!(read_token_response(&response, 0).unwrap().principal.as_deref(), Some("bob"));
    let response = json_response(json!({ "access_token": "token-1" }));
    assert_eq!(read_token_response(&response, 0).unwrap().principal, None);
    // A refresh without an id token keeps the account of the login
    let mut channel = oauth_channel(Some(1_000));
    if let Some(token) = channel.access_token.as_mut() {
        token.principal = Some("alice".into());
    }
    let TokenRefresh::Started(_) = channel.begin_token_refresh(0) else { panic!("a refresh") };
    channel.finish_token_refresh(&json_response(json!({ "access_token": "token-2", "expires_in": 60 })), 0).unwrap();
    assert_eq!(channel.access_token.as_ref().and_then(|token| token.principal.as_deref()), Some("alice"));
}

#[test]
fn builds_requests_as_data() {
    let mut request = HttpRequest::new(HttpMethod::Get, "https://h");
    request.set_header("x-a", "1");
    request.set_header("X-A", "2");
    assert_eq!(request.headers.iter().collect::<Vec<_>>(), [("X-A", "2")]);
}
