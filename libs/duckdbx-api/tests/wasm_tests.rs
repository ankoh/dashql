#![cfg(feature = "wasm")]

#[cfg(feature = "browser")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

use duckdbx_api;
use std::assert_eq;
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn pass() {
    assert_eq!(1 + 1, 2);
}

#[wasm_bindgen_test(async)]
async fn hello_duckdb() {
    let client = duckdbx_api::DatabaseClient::create().await.unwrap();
    let db = client.open_in_memory().await.unwrap();
    let conn = db.connect().await.unwrap();
    let result = conn.run_query("select 1;").await.unwrap();
    assert_eq!(result.len(), 1);
    conn.close().await.unwrap();
}
