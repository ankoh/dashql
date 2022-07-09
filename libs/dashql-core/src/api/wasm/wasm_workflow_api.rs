use std::{cell::RefCell, sync::Arc};

use js_sys::{JsString, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::api::workflow_api::{WorkflowAPI, WorkflowFrontend};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "JsWorkflowFrontend")]
    pub type JsWorkflowFrontend;

    #[wasm_bindgen(catch, method, js_name = "beginBatchUpdate")]
    fn begin_batch_update(this: &JsWorkflowFrontend, session_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "endBatchUpdate")]
    fn end_batch_update(this: &JsWorkflowFrontend, session_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateProgram")]
    fn update_program(this: &JsWorkflowFrontend, session_id: u32, program: Uint8Array) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateTaskGraph")]
    fn update_task_graph(this: &JsWorkflowFrontend, session_id: u32, graph: String) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateTaskStatus")]
    fn update_task_status(
        this: &JsWorkflowFrontend,
        session_id: u32,
        task_id: u32,
        status: u32,
        error: JsValue,
    ) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "deleteTaskState")]
    fn delete_task_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateInputState")]
    fn update_input_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateImportState")]
    fn update_import_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateTableState")]
    fn update_table_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(catch, method, js_name = "updateVisualizationState")]
    fn update_visualization_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32) -> Result<(), JsValue>;
}

struct JsWorkflowFrontendBridge {
    inner: JsWorkflowFrontend,
}

impl JsWorkflowFrontendBridge {
    fn map_result(&self, result: Result<(), JsValue>) -> Result<(), String> {
        result.map_err(|e| {
            js_sys::JSON::stringify(&e)
                .map(|s| s.as_string().unwrap_or_default())
                .unwrap_or_default()
        })
    }
}

impl WorkflowFrontend for JsWorkflowFrontendBridge {
    fn begin_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        self.map_result(self.inner.begin_batch_update(session_id))
    }
    fn end_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        self.map_result(self.inner.end_batch_update(session_id))
    }
    fn update_program(
        self: &Arc<Self>,
        session_id: u32,
        program: &Arc<crate::grammar::ProgramContainer>,
    ) -> Result<(), String> {
        let program_ipc = program.get_program().ast_data;
        let program_array = Uint8Array::new_with_length(program_ipc.len() as u32);
        program_array.copy_from(&program_ipc);
        self.map_result(self.inner.update_program(session_id, program_array))
    }
    fn update_task_graph(
        self: &Arc<Self>,
        session_id: u32,
        graph: &Arc<crate::analyzer::task_planner::TaskGraph>,
    ) -> Result<(), String> {
        let graph_json = serde_json::to_string(graph.as_ref()).map_err(|e| e.to_string())?;
        self.map_result(self.inner.update_task_graph(session_id, graph_json))
    }
    fn update_task_status(
        self: &Arc<Self>,
        session_id: u32,
        task_id: u32,
        status: crate::analyzer::task::TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String> {
        let err: JsValue = match error {
            Some(s) => JsValue::from(JsString::from(s)),
            None => JsValue::undefined(),
        };
        self.map_result(self.inner.update_task_status(session_id, task_id, status as u32, err))
    }
    fn delete_task_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.map_result(self.inner.delete_task_state(session_id, state_id))
    }
    fn update_input_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.map_result(self.inner.update_input_state(session_id, state_id))
    }
    fn update_import_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.map_result(self.inner.update_import_state(session_id, state_id))
    }
    fn update_table_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.map_result(self.inner.update_table_state(session_id, state_id))
    }
    fn update_visualization_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.map_result(self.inner.update_visualization_state(session_id, state_id))
    }
}

thread_local! {
    static WORKFLOW_API: RefCell<WorkflowAPI<JsWorkflowFrontendBridge>>  = RefCell::new(WorkflowAPI::default());
}

#[wasm_bindgen(js_name = "workflowCreateSession")]
pub async fn create_session(frontend: JsWorkflowFrontend) -> Result<u32, JsValue> {
    let frontend = Arc::new(JsWorkflowFrontendBridge { inner: frontend });
    let session = WORKFLOW_API.with(|api_cell| {
        let mut api = api_cell.borrow_mut();
        api.create_session(frontend)
    })?;
    Ok(session)
}

#[wasm_bindgen(js_name = "workflowCloseSession")]
pub async fn close_session(session_id: u32) -> Result<(), JsValue> {
    WORKFLOW_API.with(|api_cell| {
        let mut api = api_cell.borrow_mut();
        api.release_session(session_id)
    });
    Ok(())
}

#[wasm_bindgen(js_name = "workflowUpdateProgram")]
pub async fn update_program(session_id: u32, text: String) -> Result<(), JsValue> {
    let session_mtx = match WORKFLOW_API.with(|api_cell| api_cell.borrow().get_session(session_id as u32)) {
        Some(session) => session,
        None => return Err(format!("unknown session id: {}", session_id))?,
    };
    let mut session_guard = session_mtx.lock().expect("cannot lock session");
    session_guard.update_program(&text)?;
    Ok(())
}
