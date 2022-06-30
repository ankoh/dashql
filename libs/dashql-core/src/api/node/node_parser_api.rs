use crate::external;
use neon::{prelude::*, types::buffer::TypedArray};

pub fn parse_script(mut cx: FunctionContext) -> JsResult<JsArrayBuffer> {
    let text = cx.argument::<JsString>(0)?.value(&mut cx);
    let result = external::native::parser::parse_with(&text, |data| {
        JsArrayBuffer::new(&mut cx, data.len()).map(|mut buffer| {
            let writer: &mut [u8] = buffer.as_mut_slice(&mut cx);
            writer.copy_from_slice(data);
            buffer
        })
    })
    .or_else(|e| cx.throw_error(e.to_string()))?
    .or_else(|e| cx.throw_error(e.to_string()))?;
    Ok(result)
}

pub fn export_parser_api(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("parse_script", parse_script)?;
    Ok(())
}
