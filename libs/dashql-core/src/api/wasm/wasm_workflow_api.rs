use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

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
        task_class: u32,
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

#[wasm_bindgen(js_name = "createWorkflowSession")]
pub async fn create_session(frontend: JsWorkflowFrontend) -> Result<u32, JsValue> {
    Ok(42)
}

#[wasm_bindgen(js_name = "closeWorkflowSession")]
pub async fn close_session(session_id: u32) -> Result<(), JsValue> {
    Ok(())
}

#[wasm_bindgen(js_name = "runWorkflowQuery")]
pub async fn updateProgram(session_id: u32, text: String) -> Result<Uint8Array, JsValue> {
    Ok(Uint8Array::new_with_length(0))
}
