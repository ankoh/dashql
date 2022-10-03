use std::{
    cell::RefCell,
    mem::transmute,
    sync::{Arc, Mutex},
};

use futures::executor::block_on;
use neon::{prelude::*, types::buffer::TypedArray};

use crate::{
    analyzer::{
        input_spec::InputSpec, program_instance::ProgramInstanceContainer, task::TaskStatusCode, task_graph::TaskGraph,
        viz_spec::VizSpec,
    },
    api::{workflow_api::WorkflowAPI, workflow_frontend::Frontend},
    error::SystemError,
    grammar::ProgramContainer,
};

struct JsFrontend {
    inner: Arc<Root<JsObject>>,
    channel: Channel,
}

impl JsFrontend {
    fn get_inner<'a>(&self, ctx: &mut impl Context<'a>) -> Handle<'a, JsObject> {
        self.inner.to_inner(ctx)
    }
}

impl Frontend for Arc<JsFrontend> {
    fn flush_updates(&self, session_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "flushUpdates")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_program(&self, session_id: u32, program: Arc<ProgramContainer>) -> Result<(), String> {
        let self2 = self.clone();
        let text = program.get_text().as_bytes().to_vec();
        let program_id = program.get_program().program_id;
        let ast_ipc = program.get_program().ast_data.to_vec();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let program_id = JsNumber::new(&mut cx, program_id).as_value(&mut cx);
            let mut text_buffer = JsArrayBuffer::new(&mut cx, text.len())?;
            let mut ast_buffer = JsArrayBuffer::new(&mut cx, ast_ipc.len())?;
            text_buffer.as_mut_slice(&mut cx).copy_from_slice(&text);
            ast_buffer.as_mut_slice(&mut cx).copy_from_slice(&ast_ipc);
            let text_buffer = text_buffer.as_value(&mut cx);
            let ast_buffer = ast_buffer.as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateProgram")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, program_id, text_buffer, ast_buffer])?;
            Ok(())
        });
        Ok(())
    }
    fn update_program_analysis(&self, session_id: u32, analysis: Arc<ProgramInstanceContainer>) -> Result<(), String> {
        let self2 = self.clone();
        let analysis = serde_json::to_string(&analysis.instance).map_err(|e| e.to_string())?;
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let analysis = JsString::new(&mut cx, analysis).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateProgramAnalysis")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, analysis])?;
            Ok(())
        });
        Ok(())
    }
    fn update_task_graph<'a>(&self, session_id: u32, graph: Arc<TaskGraph>) -> Result<(), String> {
        let self2 = self.clone();
        let graph_json = serde_json::to_string(&graph).map_err(|e| e.to_string())?;
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let graph_json = JsString::new(&mut cx, &graph_json).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTaskGraph")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, graph_json])?;
            Ok(())
        });
        Ok(())
    }
    fn update_task_status(
        &self,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let task_id = JsNumber::new(&mut cx, task_id).as_value(&mut cx);
            let status = JsNumber::new(&mut cx, status as u8).as_value(&mut cx);
            let error = match error {
                Some(value) => JsString::new(&mut cx, value).as_value(&mut cx),
                None => cx.undefined().as_value(&mut cx),
            };
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTaskStatus")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, task_id, status, error])?;
            Ok(())
        });
        Ok(())
    }
    fn delete_task_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let data_id = JsNumber::new(&mut cx, data_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "deleteTaskData")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_input_data(&self, session_id: u32, data_id: u32, input: Arc<InputSpec>) -> Result<(), String> {
        let self2 = self.clone();
        let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let data_id = JsNumber::new(&mut cx, data_id).as_value(&mut cx);
            let input_json = JsString::new(&mut cx, &input_json).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateInputData")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_id, input_json])?;
            Ok(())
        });
        Ok(())
    }
    fn update_import_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let data_id = JsNumber::new(&mut cx, data_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTableData")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_table_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let data_id = JsNumber::new(&mut cx, data_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTableData")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_visualization_data(&self, session_id: u32, data_id: u32, viz: Arc<VizSpec>) -> Result<(), String> {
        let self2 = self.clone();
        let viz_json = serde_json::to_string(&viz).map_err(|e| e.to_string())?;
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let data_id = JsNumber::new(&mut cx, data_id).as_value(&mut cx);
            let viz_json = JsString::new(&mut cx, &viz_json).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateVisualizationData")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_id, viz_json])?;
            Ok(())
        });
        Ok(())
    }
}

thread_local! {
    static WORKFLOW_API: RefCell<Option<Arc<Mutex<WorkflowAPI>>>>  = RefCell::new(None);
}

fn get_api() -> Result<Arc<Mutex<WorkflowAPI>>, SystemError> {
    WORKFLOW_API.with(|api_cell| {
        let mut api_opt = api_cell.borrow_mut();
        let api = match api_opt.as_mut() {
            Some(api) => api,
            None => return Err(SystemError::Generic("workflow api not initialized".to_string())),
        };
        Ok(api.clone())
    })
}

pub fn configure_default<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let workflow = block_on(WorkflowAPI::new()).or_else(|e| cx.throw_error(e.to_string()))?;
    WORKFLOW_API.with(|api_cell| api_cell.replace(Some(Arc::new(Mutex::new(workflow)))));
    Ok(cx.undefined())
}

pub fn create_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsNumber> {
    let frontend = Arc::new(Arc::new(JsFrontend {
        inner: Arc::new(cx.argument::<JsObject>(0)?.root(&mut cx)),
        channel: cx.channel(),
    }));
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = block_on(api.lock().unwrap().create_session(frontend)).or_else(|e| cx.throw_error(e.to_string()))?;
    Ok(JsNumber::new(&mut cx, session))
}

pub fn close_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let callback = cx.argument::<JsFunction>(0)?.root(&mut cx);
    let session_id = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    if let Some(session) = api.lock().unwrap().release_session(session_id as u32) {
        let frontend: &Arc<JsFrontend> = unsafe { transmute(&session.frontend) };
        frontend.channel.send(|mut cx| {
            let callback = callback.into_inner(&mut cx);
            let this = cx.undefined();
            callback.call(&mut cx, this, &[])?;
            Ok(())
        });
    }
    Ok(cx.undefined())
}

pub fn update_program<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let callback = cx.argument::<JsFunction>(0)?.root(&mut cx);
    let session_id = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let text = cx.argument::<JsString>(2)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = match api.lock().unwrap().get_session(session_id as u32) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    block_on(session.update_program(&text)).or_else(|e| cx.throw_error(e.to_string()))?;
    let frontend: &Arc<JsFrontend> = unsafe { transmute(&session.frontend) };
    frontend.channel.send(|mut cx| {
        let callback = callback.into_inner(&mut cx);
        let this = cx.undefined();
        callback.call(&mut cx, this, &[])?;
        Ok(())
    });
    Ok(cx.undefined())
}

pub fn update_program_input<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let callback = cx.argument::<JsFunction>(0)?.root(&mut cx);
    let session_id = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let values = cx.argument::<JsString>(2)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = match api.lock().unwrap().get_session(session_id as u32) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    block_on(session.update_program_input(&values)).or_else(|e| cx.throw_error(e.to_string()))?;
    let frontend: &Arc<JsFrontend> = unsafe { transmute(&session.frontend) };
    frontend.channel.send(|mut cx| {
        let callback = callback.into_inner(&mut cx);
        let this = cx.undefined();
        callback.call(&mut cx, this, &[])?;
        Ok(())
    });
    Ok(cx.undefined())
}

pub fn execute_program<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let callback = cx.argument::<JsFunction>(0)?.root(&mut cx);
    let session_id = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = match api.lock().unwrap().get_session(session_id as u32) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    block_on(session.execute_program()).or_else(|e| cx.throw_error(e.to_string()))?;
    let frontend: &Arc<JsFrontend> = unsafe { transmute(&session.frontend) };
    frontend.channel.send(|mut cx| {
        let callback = callback.into_inner(&mut cx);
        let this = cx.undefined();
        callback.call(&mut cx, this, &[])?;
        Ok(())
    });
    Ok(cx.undefined())
}

pub fn edit_program<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let callback = cx.argument::<JsFunction>(0)?.root(&mut cx);
    let session_id = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let edits = cx.argument::<JsString>(2)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = match api.lock().unwrap().get_session(session_id as u32) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    block_on(session.edit_program(&edits)).or_else(|e| cx.throw_error(e.to_string()))?;
    let frontend: &Arc<JsFrontend> = unsafe { transmute(&session.frontend) };
    frontend.channel.send(|mut cx| {
        let callback = callback.into_inner(&mut cx);
        let this = cx.undefined();
        callback.call(&mut cx, this, &[])?;
        Ok(())
    });
    Ok(cx.undefined())
}

pub fn run_query<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsArrayBuffer> {
    let session_id = cx.argument::<JsNumber>(0)?.value(&mut cx);
    let text = cx.argument::<JsString>(1)?.value(&mut cx);
    let api = get_api().or_else(|e| cx.throw_error(e.to_string()))?;
    let session = match api.lock().unwrap().get_session(session_id as u32) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    let result = block_on(session.run_query(&text)).or_else(|e| cx.throw_error(e.to_string()))?;
    let result_data = result.read_native_data_handle().access();
    let buffer = JsArrayBuffer::new(&mut cx, result_data.len()).map(|mut buffer| {
        let writer: &mut [u8] = buffer.as_mut_slice(&mut cx);
        writer.copy_from_slice(result_data);
        buffer
    })?;
    Ok(buffer)
}

pub fn export_workflow_api(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("workflow_configure_default", configure_default)?;
    cx.export_function("workflow_create_session", create_session)?;
    cx.export_function("workflow_close_session", close_session)?;
    cx.export_function("workflow_update_program", update_program)?;
    cx.export_function("workflow_update_program_input", update_program_input)?;
    cx.export_function("workflow_execute_program", execute_program)?;
    cx.export_function("workflow_run_query", run_query)?;
    Ok(())
}
