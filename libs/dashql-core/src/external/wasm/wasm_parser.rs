//use crate::utils::arrow_ipc::read_arrow_ipc_buffer;
use dashql_proto as proto;
//use js_sys::Uint8Array;
use std::error::Error;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/external/wasm/wasm_parser.mjs")]
extern "C" {
    #[wasm_bindgen(js_name = "parse", catch)]
    async fn ext_parse(text: &str) -> Result<JsValue, JsValue>;
}

pub fn parse<'a>(alloc: &'a bumpalo::Bump, text: &str) -> Result<proto::Program<'a>, Box<dyn Error + Send + Sync>> {
    todo!()
}
