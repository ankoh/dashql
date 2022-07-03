use crate::external;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "parseScript")]
pub fn parse_script(text: String) -> Result<Uint8Array, String> {
    let result = external::wasm::wasm_parser::js_parse(&text).map_err(|e| e.as_string().unwrap_or_default())?;
    let ast_array: Uint8Array = result.into();
    Ok(ast_array)
}
