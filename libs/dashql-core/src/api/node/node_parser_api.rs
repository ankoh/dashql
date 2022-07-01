use crate::external;
use neon::{prelude::*, types::buffer::TypedArray};

pub fn parse_script(mut cx: FunctionContext) -> JsResult<JsArrayBuffer> {
    let text = cx.argument::<JsString>(0)?.value(&mut cx);
    let result = external::native::parser::parse(&text).or_else(|e| cx.throw_error(e))?;
    let result_data = result.access();
    let buffer = JsArrayBuffer::new(&mut cx, result_data.len())
        .map(|mut buffer| {
            let writer: &mut [u8] = buffer.as_mut_slice(&mut cx);
            writer.copy_from_slice(result_data);
            buffer
        })
        .or_else(|e| cx.throw_error(e.to_string()))?;
    drop(result);
    Ok(buffer)
}

pub fn export_parser_api(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("parser_parse_script", parse_script)?;
    Ok(())
}
