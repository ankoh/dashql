#![cfg(feature = "wasm")]

#[cfg(feature = "browser")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

use std::assert_eq;

use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn pass() {
    assert_eq!(1 + 1, 2);
}
