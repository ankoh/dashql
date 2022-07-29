use dashql_proto as proto;
use js_sys::Uint8Array;
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

use crate::error::SystemError;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "JsParser")]
    pub type JsParser;

    #[wasm_bindgen(catch, method, js_name = "parse")]
    async fn parse(this: &JsParser, text: &str) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(js_name = "JsParserResult")]
    pub type JsParserResult;

    #[wasm_bindgen(method, js_name = "delete")]
    fn delete(this: &JsParserResult) -> JsValue;
    #[wasm_bindgen(method, js_name = "getDataCopy")]
    fn get_data_copy(this: &JsParserResult) -> JsValue;
    #[wasm_bindgen(method, js_name = "getData")]
    fn get_data(this: &JsParserResult) -> JsValue;
}

thread_local! {
    static PARSER: RefCell<Option<Rc<JsParser>>> = RefCell::new(None);
}

#[wasm_bindgen(js_name = "linkParser")]
pub fn link_parser(parser: JsParser) {
    PARSER.with(|linked| linked.replace(Some(Rc::new(parser))));
}

pub async fn parse<'a>(text: &'a str) -> Result<Uint8Array, SystemError> {
    let parser: Option<Rc<JsParser>> = PARSER.with(|linked| linked.borrow().clone());
    let parser = match parser {
        Some(parser) => parser,
        None => return Err(SystemError::Generic("parser not linked".to_string())),
    };
    let result: JsParserResult = parser
        .parse(text)
        .await
        .map_err(|e| {
            let err = js_sys::Error::from(e);
            SystemError::Generic(err.message().as_string().unwrap_or_default())
        })?
        .into();
    let ast_array: Uint8Array = result.get_data_copy().into();
    result.delete();
    Ok(ast_array)
}

pub async fn parse_into<'a, 'b: 'a>(
    alloc: &'a bumpalo::Bump,
    text: &'b str,
) -> Result<(proto::Program<'a>, &'a [u8]), SystemError> {
    let parser: Option<Rc<JsParser>> = PARSER.with(|linked| linked.borrow().clone());
    let parser = match parser {
        Some(parser) => parser,
        None => return Err(SystemError::Generic("parser not linked".to_string())),
    };
    let result: JsParserResult = parser
        .parse(text)
        .await
        .map_err(|e| {
            let err = js_sys::Error::from(e);
            SystemError::Generic(err.message().as_string().unwrap_or_default())
        })?
        .into();
    let ast_array: Uint8Array = result.get_data().into();
    let mut ast_buffer = alloc.alloc_slice_fill_default(ast_array.length() as usize);
    ast_array.copy_to(&mut ast_buffer);
    result.delete();
    let root = flatbuffers::root::<proto::Program>(ast_buffer).map_err(|e| SystemError::Generic(e.to_string()))?;
    Ok((root, ast_buffer))
}
