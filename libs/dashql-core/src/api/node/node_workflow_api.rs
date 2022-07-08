use std::{cell::RefCell, sync::Arc};

use neon::{prelude::*, types::buffer::TypedArray};

use crate::{
    analyzer::{task::TaskStatusCode, task_planner::TaskGraph},
    api::workflow_api::{WorkflowAPI, WorkflowFrontend},
    grammar::ProgramContainer,
};

struct JsWorkflowFrontend {
    inner: Arc<Root<JsObject>>,
    channel: Channel,
}

impl JsWorkflowFrontend {
    fn get_inner<'a>(&self, ctx: &mut impl Context<'a>) -> Handle<'a, JsObject> {
        self.inner.to_inner(ctx)
    }
}

impl WorkflowFrontend for JsWorkflowFrontend {
    fn begin_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "beginBatchUpdate")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id])?;
            Ok(())
        });
        Ok(())
    }
    fn end_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "endBatchUpdate")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_program(self: &Arc<Self>, session_id: u32, program: &Arc<ProgramContainer>) -> Result<(), String> {
        let self2 = self.clone();
        let program_ipc = program.get_program().ast_data.to_vec();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let mut data_buffer = JsArrayBuffer::new(&mut cx, program_ipc.len())?;
            let data_slice = data_buffer.as_mut_slice(&mut cx);
            data_slice.copy_from_slice(&program_ipc);
            let data_buffer = data_buffer.as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateProgram")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, data_buffer])?;
            Ok(())
        });
        Ok(())
    }

    fn update_task_graph<'a>(self: &Arc<Self>, session_id: u32, graph: &Arc<TaskGraph>) -> Result<(), String> {
        let self2 = self.clone();
        let graph_json = serde_json::to_string(graph.as_ref()).map_err(|e| e.to_string())?;
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
        self: &Arc<Self>,
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
    fn delete_task_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let state_id = JsNumber::new(&mut cx, state_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "deleteTaskState")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, state_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_input_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let state_id = JsNumber::new(&mut cx, state_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateInputState")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, state_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_import_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let state_id = JsNumber::new(&mut cx, state_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTableState")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, state_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_table_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let state_id = JsNumber::new(&mut cx, state_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateTableState")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, state_id])?;
            Ok(())
        });
        Ok(())
    }
    fn update_visualization_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        let self2 = self.clone();
        self.channel.send(move |mut cx| {
            let session_id = JsNumber::new(&mut cx, session_id).as_value(&mut cx);
            let state_id = JsNumber::new(&mut cx, state_id).as_value(&mut cx);
            let frontend = self2.get_inner(&mut cx);
            let method: Handle<JsFunction> = frontend.get(&mut cx, "updateVisualizationState")?;
            let this = frontend.as_value(&mut cx);
            method.call(&mut cx, this, &[session_id, state_id])?;
            Ok(())
        });
        Ok(())
    }
}

thread_local! {
    static WORKFLOW_API: RefCell<WorkflowAPI<JsWorkflowFrontend>>  = RefCell::new(WorkflowAPI::default());
}

pub fn create_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsNumber> {
    let frontend: Arc<JsWorkflowFrontend> = Arc::new(JsWorkflowFrontend {
        inner: Arc::new(cx.argument::<JsObject>(0)?.root(&mut cx)),
        channel: cx.channel(),
    });
    let session = WORKFLOW_API
        .with(|api_cell| {
            let mut api = api_cell.borrow_mut();
            api.create_session(frontend)
        })
        .or_else(|e| cx.throw_error(e))?;
    Ok(JsNumber::new(&mut cx, session))
}

pub fn close_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let session_id = cx.argument::<JsNumber>(0)?.value(&mut cx);
    let callback = cx.argument::<JsFunction>(1)?.root(&mut cx);
    WORKFLOW_API.with(|api_cell| {
        let mut api = api_cell.borrow_mut();
        if let Some(session) = api.release_session(session_id as u32) {
            let session_lock = session.lock().unwrap();
            session_lock.frontend.channel.send(|mut cx| {
                let callback = callback.into_inner(&mut cx);
                let this = cx.undefined();
                callback.call(&mut cx, this, &[])?;
                Ok(())
            });
        }
    });
    Ok(cx.undefined())
}

pub fn update_program<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let session_id = cx.argument::<JsNumber>(0)?.value(&mut cx);
    let text = cx.argument::<JsString>(1)?.value(&mut cx);
    let session_mtx = match WORKFLOW_API.with(|api_cell| api_cell.borrow().get_session(session_id as u32)) {
        Some(session) => session,
        None => cx.throw_error(format!("unknown session id: {}", session_id))?,
    };
    let mut session_guard = session_mtx.lock().expect("cannot lock session");
    session_guard.update_program(&text).or_else(|e| cx.throw_error(e))?;
    Ok(cx.undefined())
}

pub fn export_workflow_api(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("workflow_create_session", create_session)?;
    cx.export_function("workflow_close_session", close_session)?;
    cx.export_function("workflow_update_program", update_program)?;
    Ok(())
}
