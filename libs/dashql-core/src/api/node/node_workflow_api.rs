use neon::prelude::*;

use crate::analyzer::task_planner::{TaskClass, TaskGraph, TaskStatusCode};

struct JsWorkflowFrontend {
    value: JsObject,
}

impl JsWorkflowFrontend {
    fn call_method<'a>(
        &self,
        cx: &mut impl Context<'a>,
        method_name: &str,
        args: &[Handle<'a, JsValue>],
    ) -> Result<(), String> {
        let method: Handle<JsFunction> = self.value.get(cx, method_name).map_err(|e| e.to_string())?;
        let handle = self.value.as_value(cx);
        method.call(cx, handle, args).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn begin_batch_update<'a>(&self, cx: &mut FunctionContext<'a>, session_id: u32) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        self.call_method(cx, "beginBatchUpdate", &[session_id])
    }
    pub fn end_batch_update<'a>(&self, cx: &mut FunctionContext<'a>, session_id: u32) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        self.call_method(cx, "beginBatchUpdate", &[session_id])
    }
    pub fn update_program<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        program_ipc: &mut [u8],
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        unsafe {
            let program_ipc = std::mem::transmute::<&mut [u8], &'static mut [u8]>(program_ipc);
            let program_buffer = JsArrayBuffer::external(cx, program_ipc);
            let program_buffer = program_buffer.as_value(cx);
            self.call_method(cx, "updateProgram", &[session_id, program_buffer])
        }
    }
    pub fn update_task_graph<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        graph: &TaskGraph,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let data = serde_json::to_string(&graph).map_err(|e| e.to_string())?;
        let data = JsString::new(cx, data).as_value(cx);
        self.call_method(cx, "updateTaskGraph", &[session_id, data])
    }
    pub fn update_task_status<'a>(
        &self,
        cx: &mut impl Context<'a>,
        session_id: u32,
        task_class: TaskClass,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<JsValue>,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let task_class = JsNumber::new(cx, task_class as u8).as_value(cx);
        let task_id = JsNumber::new(cx, task_id).as_value(cx);
        let status = JsNumber::new(cx, status as u8).as_value(cx);
        let error = match error {
            Some(value) => value.as_value(cx),
            None => cx.undefined().as_value(cx),
        };
        self.call_method(
            cx,
            "updateTaskStatus",
            &[session_id, task_class, task_id, status, error],
        )
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

pub fn create_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    Ok(cx.undefined())
}

pub fn close_session<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    Ok(cx.undefined())
}

pub fn update_program<'a>(mut cx: FunctionContext<'a>) -> JsResult<JsUndefined> {
    Ok(cx.undefined())
}
