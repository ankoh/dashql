use crate::external;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "parseScript")]
pub async fn parse_script(text: String) -> Result<Uint8Array, String> {
    let result = external::wasm::parser::parse(&text).await.map_err(|e| e.to_string())?;
    let ast_array: Uint8Array = result.into();
    Ok(ast_array)
}
