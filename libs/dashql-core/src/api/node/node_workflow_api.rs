use std::{cell::RefCell, sync::Arc};

use neon::{prelude::*, types::buffer::TypedArray};

use crate::{
    analyzer::{task::TaskStatusCode, task_planner::TaskGraph},
    api::workflow_api::{WorkflowAPI, WorkflowFrontend},
    grammar::ProgramContainer,
};

struct JsWorkflowFrontend {
    value: Root<JsObject>,
}

impl JsWorkflowFrontend {
    fn call_method<'a>(
        &self,
        cx: &mut impl Context<'a>,
        method_name: &str,
        args: &[Handle<'a, JsValue>],
    ) -> Result<(), String> {
        let value = self.value.to_inner(cx);
        let method: Handle<JsFunction> = value.get(cx, method_name).map_err(|e| e.to_string())?;
        let handle = value.as_value(cx);
        method.call(cx, handle, args).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn begin_batch_update<'a>(&self, cx: &mut impl Context<'a>, session_id: u32) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        self.call_method(cx, "beginBatchUpdate", &[session_id])
    }
    pub fn end_batch_update<'a>(&self, cx: &mut impl Context<'a>, session_id: u32) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        self.call_method(cx, "beginBatchUpdate", &[session_id])
    }
    pub fn update_program<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        program_ipc: Vec<u8>,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let mut data_buffer = JsArrayBuffer::new(cx, program_ipc.len()).map_err(|e| e.to_string())?;
        let data_slice = data_buffer.as_mut_slice(cx);
        data_slice.copy_from_slice(&program_ipc);
        let program_buffer = data_buffer.as_value(cx);
        self.call_method(cx, "updateProgram", &[session_id, program_buffer])?;
        Ok(())
    }
    pub fn update_task_graph<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        graph_json: &str,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let graph_json = JsString::new(cx, graph_json).as_value(cx);
        self.call_method(cx, "updateTaskGraph", &[session_id, graph_json])
    }
    pub fn update_task_status<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<JsValue>,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let task_id = JsNumber::new(cx, task_id).as_value(cx);
        let status = JsNumber::new(cx, status as u8).as_value(cx);
        let error = match error {
            Some(value) => value.as_value(cx),
            None => cx.undefined().as_value(cx),
        };
        self.call_method(cx, "updateTaskStatus", &[session_id, task_id, status, error])
    }
    pub fn delete_task_state<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "deleteTaskState", &[session_id, state_id])
    }
    pub fn update_input_state<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateInputState", &[session_id, state_id])
    }
    pub fn update_import_state<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateImportState", &[session_id, state_id])
    }
    pub fn update_table_state<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateTableState", &[session_id, state_id])
    }
    pub fn update_visualization_state<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateVisualizationState", &[session_id, state_id])
    }
}

struct JsWorkflowFrontendBridge {
    frontend: Arc<JsWorkflowFrontend>,
    channel: Channel,
}

impl WorkflowFrontend for JsWorkflowFrontendBridge {
    fn begin_batch_update(&mut self, session_id: u32) -> Result<(), String> {
        let frontend = self.frontend.clone();
        self.channel.send(move |mut cx| {
            frontend
                .begin_batch_update(&mut cx, session_id)
                .or_else(|e| cx.throw_error(e))
        });
        Ok(())
    }
    fn end_batch_update(&mut self, session_id: u32) -> Result<(), String> {
        let frontend = self.frontend.clone();
        self.channel.send(move |mut cx| {
            frontend
                .end_batch_update(&mut cx, session_id)
                .or_else(|e| cx.throw_error(e))
        });
        Ok(())
    }
    fn update_program(&mut self, session_id: u32, program: &Arc<ProgramContainer>) -> Result<(), String> {
        let frontend = self.frontend.clone();
        let program = program.get_program().ast_data.to_vec();
        self.channel.send(move |mut cx| {
            frontend
                .update_program(&mut cx, session_id, program)
                .or_else(|e| cx.throw_error(e))
        });
        Ok(())
    }
    fn update_task_graph(&mut self, session_id: u32, graph: &Arc<TaskGraph>) -> Result<(), String> {
        let frontend = self.frontend.clone();
        let graph = graph.clone();
        self.channel.send(move |mut cx| {
            let graph_json = serde_json::to_string(graph.as_ref()).or_else(|e| cx.throw_error(e.to_string()))?;
            frontend
                .update_task_graph(&mut cx, session_id, &graph_json)
                .or_else(|e| cx.throw_error(e))
        });
        todo!()
    }

    fn update_task_status(
        &self,
        session_id: u32,
        task_class: u32,
        task_id: u32,
        status: u32,
        error: Option<String>,
    ) -> Result<(), String> {
        todo!()
    }

    fn delete_task_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String> {
        todo!()
    }

    fn update_input_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String> {
        todo!()
    }

    fn update_import_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String> {
        todo!()
    }

    fn update_table_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String> {
        todo!()
    }

    fn update_visualization_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String> {
        todo!()
    }
}

thread_local! {
    static WORKFLOW_API: RefCell<WorkflowAPI>  = RefCell::new(WorkflowAPI::default());
}

pub fn create_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsNumber> {
    let frontend = Arc::new(JsWorkflowFrontend {
        value: cx.argument::<JsObject>(0)?.root(&mut cx),
    });
    let frontend_bridge: Box<dyn WorkflowFrontend> = Box::new(JsWorkflowFrontendBridge {
        channel: cx.channel(),
        frontend: frontend,
    });
    let session = WORKFLOW_API
        .with(|api_cell| {
            let mut api = api_cell.borrow_mut();
            api.create_session(frontend_bridge)
        })
        .or_else(|e| cx.throw_error(e))?;
    Ok(JsNumber::new(&mut cx, session))
}

pub fn close_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    let session_id = cx.argument::<JsNumber>(0)?.value(&mut cx);
    WORKFLOW_API
        .with(|api_cell| {
            let mut api = api_cell.borrow_mut();
            api.close_session(session_id as u32)
        })
        .or_else(|e| cx.throw_error(e))?;
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
