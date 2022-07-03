use neon::prelude::*;

use crate::{analyzer::task_planner::TaskGraph, grammar::Program};

struct JsWorkflowFrontend {
    value: JsObject,
}

impl JsWorkflowFrontend {
    fn call_method<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
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
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        program: &Program,
    ) -> Result<(), String> {
        todo!();
    }
    pub fn update_task_graph<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        graph: &TaskGraph,
    ) -> Result<(), String> {
        todo!();
    }
    pub fn update_task_status<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        task_class: u32,
        task_id: u32,
        status: u32,
        error: JsValue,
    ) -> Result<(), String> {
        todo!();
    }
    pub fn delete_task_state<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "deleteTaskState", &[session_id, state_id])
    }
    pub fn update_input_state<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateInputState", &[session_id, state_id])
    }
    pub fn update_import_state<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateImportState", &[session_id, state_id])
    }
    pub fn update_table_state<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
        session_id: u32,
        state_id: u32,
    ) -> Result<(), String> {
        let session_id = JsNumber::new(cx, session_id).as_value(cx);
        let state_id = JsNumber::new(cx, state_id).as_value(cx);
        self.call_method(cx, "updateTableState", &[session_id, state_id])
    }
    pub fn update_visualization_state<'a>(
        &self,
        cx: &mut FunctionContext<'a>,
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
