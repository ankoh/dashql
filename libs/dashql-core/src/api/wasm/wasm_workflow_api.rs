use std::{cell::RefCell, sync::Arc, sync::Mutex};

use js_sys::{JsString, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::{
    analyzer::{
        input_spec::InputSpec, program_instance::ProgramInstanceContainer, task_graph::TaskGraph, viz_spec::VizSpec,
    },
    api::{workflow_api::WorkflowAPI, workflow_frontend::Frontend},
    error::SystemError,
    grammar::ProgramContainer,
};

#[wasm_bindgen]
extern "C" {
    pub type JsFrontend;

    #[wasm_bindgen(structural, method, js_name = "flushUpdates")]
    fn flush_updates(this: &JsFrontend, session_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateProgram")]
    fn update_program(this: &JsFrontend, session_id: u32, program_id: u32, text: Uint8Array, ast: Uint8Array);
    #[wasm_bindgen(structural, method, js_name = "updateProgramAnalysis")]
    fn update_program_analysis(this: &JsFrontend, session_id: u32, analysis: &str);
    #[wasm_bindgen(structural, method, js_name = "updateTaskGraph")]
    fn update_task_graph(this: &JsFrontend, session_id: u32, graph: &str);
    #[wasm_bindgen(structural, method, js_name = "updateTaskStatus")]
    fn update_task_status(this: &JsFrontend, session_id: u32, task_id: u32, status: u32, error: JsValue);
    #[wasm_bindgen(structural, method, js_name = "deleteTaskData")]
    fn delete_task_data(this: &JsFrontend, session_id: u32, data_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateInputData")]
    fn update_input_data(this: &JsFrontend, session_id: u32, data_id: u32, input: &str);
    #[wasm_bindgen(structural, method, js_name = "updateImportData")]
    fn update_import_data(this: &JsFrontend, session_id: u32, data_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateTableData")]
    fn update_table_data(this: &JsFrontend, session_id: u32, data_id: u32);
    #[wasm_bindgen(structural, method, js_name = "updateVisualizationData")]
    fn update_visualization_data(this: &JsFrontend, session_id: u32, data_id: u32, viz: &str);
}

struct JsFrontendBridge {
    inner: JsFrontend,
}

impl Frontend for JsFrontendBridge {
    fn flush_updates(&self, session_id: u32) -> Result<(), String> {
        self.inner.flush_updates(session_id);
        Ok(())
    }
    fn update_program(&self, session_id: u32, program: Arc<ProgramContainer>) -> Result<(), String> {
        let program_id = program.get_program().program_id;
        let text = program.get_text();
        let text_bytes = text.as_bytes();
        let text_array = Uint8Array::new_with_length(text_bytes.len() as u32);
        text_array.copy_from(text_bytes);
        let ast_ipc = program.get_program().ast_data;
        let ast_array = Uint8Array::new_with_length(ast_ipc.len() as u32);
        ast_array.copy_from(&ast_ipc);
        self.inner.update_program(session_id, program_id, text_array, ast_array);
        Ok(())
    }
    fn update_program_analysis(&self, session_id: u32, analysis: Arc<ProgramInstanceContainer>) -> Result<(), String> {
        let json = serde_json::to_string(&analysis.instance).map_err(|e| e.to_string())?;
        self.inner.update_program_analysis(session_id, &json);
        Ok(())
    }
    fn update_task_graph(&self, session_id: u32, graph: Arc<TaskGraph>) -> Result<(), String> {
        let json = serde_json::to_string(&graph).map_err(|e| e.to_string())?;
        self.inner.update_task_graph(session_id, &json);
        Ok(())
    }
    fn update_task_status(
        &self,
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
    fn delete_task_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        self.inner.delete_task_data(session_id, data_id);
        Ok(())
    }
    fn update_input_data(&self, session_id: u32, data_id: u32, input: Arc<InputSpec>) -> Result<(), String> {
        let json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        self.inner.update_input_data(session_id, data_id, &json);
        Ok(())
    }
    fn update_import_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        self.inner.update_import_data(session_id, data_id);
        Ok(())
    }
    fn update_table_data(&self, session_id: u32, data_id: u32) -> Result<(), String> {
        self.inner.update_table_data(session_id, data_id);
        Ok(())
    }
    fn update_visualization_data(&self, session_id: u32, data_id: u32, spec: Arc<VizSpec>) -> Result<(), String> {
        let json = serde_json::to_string(&spec).map_err(|e| e.to_string())?;
        self.inner.update_visualization_data(session_id, data_id, &json);
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

#[wasm_bindgen(js_name = "workflowConfigureDefault")]
pub async fn configure_default() -> Result<(), JsValue> {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));

    let workflow = WorkflowAPI::new().await.map_err(|e| e.to_string())?;
    WORKFLOW_API.with(|api_cell| api_cell.replace(Some(Arc::new(Mutex::new(workflow)))));
    Ok(())
}

#[wasm_bindgen(js_name = "workflowCreateSession")]
pub async fn create_session(frontend: JsFrontend) -> Result<u32, JsValue> {
    let frontend = Arc::new(JsFrontendBridge { inner: frontend });
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
pub async fn update_program_input(_session_id: u32, _input: String) -> Result<(), JsValue> {
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
