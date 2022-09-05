use std::{cell::RefCell, sync::Arc, sync::Mutex};

use js_sys::{JsString, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::{
    analyzer::program_instance::ProgramInstance,
    api::workflow_api::{WorkflowAPI, WorkflowFrontend},
    error::SystemError,
};

#[wasm_bindgen]
extern "C" {
    pub type JsWorkflowFrontend;

    #[wasm_bindgen(structural, method, js_name = "beginBatchUpdate")]
    fn begin_batch_update(this: &JsWorkflowFrontend, session_id: u32);
    #[wasm_bindgen(structural, method, js_name = "endBatchUpdate")]
    fn end_batch_update(this: &JsWorkflowFrontend, session_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateProgram")]
    fn update_program(this: &JsWorkflowFrontend, session_id: u32, text: Uint8Array, ast: Uint8Array);
    #[wasm_bindgen(structural, method, js_name = "updateProgramAnalysis")]
    fn update_program_analysis(this: &JsWorkflowFrontend, session_id: u32, analysis: &str);
    #[wasm_bindgen(structural, method, js_name = "updateTaskGraph")]
    fn update_task_graph(this: &JsWorkflowFrontend, session_id: u32, graph: &str);
    #[wasm_bindgen(structural, method, js_name = "updateTaskStatus")]
    fn update_task_status(this: &JsWorkflowFrontend, session_id: u32, task_id: u32, status: u32, error: JsValue);
    #[wasm_bindgen(structural, method, js_name = "deleteTaskState")]
    fn delete_task_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateInputState")]
    fn update_input_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateImportState")]
    fn update_import_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateTableState")]
    fn update_table_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateVisualizationState")]
    fn update_visualization_state(this: &JsWorkflowFrontend, session_id: u32, state_id: u32);
}

struct JsWorkflowFrontendBridge {
    inner: JsWorkflowFrontend,
}

impl WorkflowFrontend for JsWorkflowFrontendBridge {
    fn begin_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        self.inner.begin_batch_update(session_id);
        Ok(())
    }
    fn end_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
        self.inner.end_batch_update(session_id);
        Ok(())
    }
    fn update_program(
        self: &Arc<Self>,
        session_id: u32,
        text: &str,
        ast: &crate::grammar::ProgramContainer,
    ) -> Result<(), String> {
        let text_bytes = text.as_bytes();
        let text_array = Uint8Array::new_with_length(text_bytes.len() as u32);
        text_array.copy_from(text_bytes);
        let ast_ipc = ast.get_program().ast_data;
        let ast_array = Uint8Array::new_with_length(ast_ipc.len() as u32);
        ast_array.copy_from(&ast_ipc);
        self.inner.update_program(session_id, text_array, ast_array);
        Ok(())
    }
    fn update_program_analysis(self: &Arc<Self>, session_id: u32, analysis: &ProgramInstance) -> Result<(), String> {
        let analysis = serde_json::to_string(analysis).map_err(|e| e.to_string())?;
        self.inner.update_program_analysis(session_id, &analysis);
        Ok(())
    }
    fn update_task_graph(
        self: &Arc<Self>,
        session_id: u32,
        graph: &crate::analyzer::task_planner::TaskGraph,
    ) -> Result<(), String> {
        let graph_json = serde_json::to_string(graph).map_err(|e| e.to_string())?;
        self.inner.update_task_graph(session_id, &graph_json);
        Ok(())
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
        self.inner.update_task_status(session_id, task_id, status as u32, err);
        Ok(())
    }
    fn delete_task_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.inner.delete_task_state(session_id, state_id);
        Ok(())
    }
    fn update_input_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.inner.update_input_state(session_id, state_id);
        Ok(())
    }
    fn update_import_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.inner.update_import_state(session_id, state_id);
        Ok(())
    }
    fn update_table_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.inner.update_table_state(session_id, state_id);
        Ok(())
    }
    fn update_visualization_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
        self.inner.update_visualization_state(session_id, state_id);
        Ok(())
    }
}

thread_local! {
    static WORKFLOW_API: RefCell<Option<Arc<Mutex<WorkflowAPI<JsWorkflowFrontendBridge>>>>>  = RefCell::new(None);
}

fn get_api() -> Result<Arc<Mutex<WorkflowAPI<JsWorkflowFrontendBridge>>>, SystemError> {
    WORKFLOW_API.with(|api_cell| {
        let mut api_opt = api_cell.borrow_mut();
        let api = match api_opt.as_mut() {
            Some(api) => api,
            None => return Err(SystemError::Generic("workflow api not initialized".to_string())),
        };
        Ok(api.clone())
    })
}

#[wasm_bindgen(js_name = "workflowConfigureDefault")]
pub async fn configure_default() -> Result<(), JsValue> {
    let workflow = WorkflowAPI::new().await.map_err(|e| e.to_string())?;
    WORKFLOW_API.with(|api_cell| api_cell.replace(Some(Arc::new(Mutex::new(workflow)))));
    Ok(())
}

#[wasm_bindgen(js_name = "workflowCreateSession")]
pub async fn create_session(frontend: JsWorkflowFrontend) -> Result<u32, JsValue> {
    let frontend = Arc::new(JsWorkflowFrontendBridge { inner: frontend });
    let api = get_api().map_err(|e| e.to_string())?;
    let session = api
        .lock()
        .unwrap()
        .create_session(frontend)
        .await
        .map_err(|e| e.to_string())?;
    Ok(session)
}

#[wasm_bindgen(js_name = "workflowCloseSession")]
pub async fn close_session(session_id: u32) -> Result<(), JsValue> {
    let api = get_api().map_err(|e| e.to_string())?;
    api.lock().unwrap().release_session(session_id);
    Ok(())
}

#[wasm_bindgen(js_name = "workflowUpdateProgram")]
pub async fn update_program(session_id: u32, text: String) -> Result<(), JsValue> {
    let session = match get_api()
        .map_err(|e| e.to_string())?
        .lock()
        .unwrap()
        .get_session(session_id)
    {
        Some(session) => session,
        None => return Err(format!("unknown session id: {}", session_id))?,
    };
    session.update_program(&text).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[wasm_bindgen(js_name = "workflowExecuteProgram")]
pub async fn execute_program(session_id: u32) -> Result<(), JsValue> {
    let session = match get_api()
        .map_err(|e| e.to_string())?
        .lock()
        .unwrap()
        .get_session(session_id)
    {
        Some(session) => session,
        None => return Err(format!("unknown session id: {}", session_id))?,
    };
    session.execute_program().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[wasm_bindgen(js_name = "workflowUpdateProgramInput")]
pub async fn update_program_input(session_id: u32, input: String) -> Result<(), JsValue> {
    Ok(())
}

#[wasm_bindgen(js_name = "workflowEditProgram")]
pub async fn edit_program(session_id: u32, edits: String) -> Result<(), JsValue> {
    let session = match get_api()
        .map_err(|e| e.to_string())?
        .lock()
        .unwrap()
        .get_session(session_id)
    {
        Some(session) => session,
        None => return Err(format!("unknown session id: {}", session_id))?,
    };
    session.edit_program(&edits).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[wasm_bindgen(js_name = "workflowRunQuery")]
pub async fn run_query(session_id: u32, text: String) -> Result<Uint8Array, JsValue> {
    let session = match get_api()
        .map_err(|e| e.to_string())?
        .lock()
        .unwrap()
        .get_session(session_id)
    {
        Some(session) => session,
        None => return Err(format!("unknown session id: {}", session_id))?,
    };
    let result = session.run_query(&text).await.map_err(|e| e.to_string())?;
    Ok(result.read_wasm_data_handle().clone())
}
