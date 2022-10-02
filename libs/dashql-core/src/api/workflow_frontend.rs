use std::sync::{Arc, Mutex};

use crate::{
    analyzer::{
        input_spec::InputSpec, program_instance::ProgramInstanceContainer, task::TaskStatusCode, task_graph::TaskGraph,
        viz_spec::VizSpec,
    },
    external::console,
    grammar::ProgramContainer,
};

pub trait Frontend {
    fn flush_updates(&self, session_id: u32) -> Result<(), String>;
    fn update_program(&self, session_id: u32, program: Arc<ProgramContainer>) -> Result<(), String>;
    fn update_program_analysis(&self, session_id: u32, analysis: Arc<ProgramInstanceContainer>) -> Result<(), String>;
    fn update_task_graph(&self, session_id: u32, graph: Arc<TaskGraph>) -> Result<(), String>;
    fn update_task_status(
        &self,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String>;
    fn delete_task_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_input_data(&self, session_id: u32, data_id: u32, input: Arc<InputSpec>) -> Result<(), String>;
    fn update_import_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_table_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_visualization_data(&self, session_id: u32, data_id: u32, viz: Arc<VizSpec>) -> Result<(), String>;
}

#[derive(Debug)]
pub enum FrontendUpdate {
    UpdateProgram(u32, Arc<ProgramContainer>),
    UpdateProgramAnalysis(u32, Arc<ProgramInstanceContainer>),
    UpdateTaskGraph(u32, Arc<TaskGraph>),
    UpdateTaskStatus(u32, u32, TaskStatusCode, Option<String>),
    DeleteTaskData(u32, u32),
    UpdateInputData(u32, u32, Arc<InputSpec>),
    UpdateImportData(u32, u32),
    UpdateTableData(u32, u32),
    UpdateVisualizationData(u32, u32, Arc<VizSpec>),
}

#[derive(Default)]
pub struct FrontendBuffer {
    frontend: Option<Arc<dyn Frontend>>,
    updates: Mutex<Vec<FrontendUpdate>>,
}

impl FrontendBuffer {
    pub fn create(frontend: Arc<dyn Frontend>) -> Self {
        Self {
            frontend: Some(frontend),
            updates: Mutex::new(Vec::new()),
        }
    }
    pub fn flush_updates_manually(&self) -> Vec<FrontendUpdate> {
        let mut locked = self.updates.lock().unwrap();
        std::mem::replace(locked.as_mut(), Vec::new())
    }
}

impl Frontend for FrontendBuffer {
    fn flush_updates(&self, session_id: u32) -> Result<(), String> {
        let frontend = match &self.frontend {
            Some(frontend) => frontend.as_ref(),
            None => return Ok(()),
        };
        let buffer = {
            let mut locked = self.updates.lock().unwrap();
            std::mem::replace(locked.as_mut(), Vec::new())
        };
        for update in buffer {
            match update {
                FrontendUpdate::UpdateProgram(sid, ast) => frontend.update_program(sid, ast),
                FrontendUpdate::UpdateProgramAnalysis(sid, analysis) => frontend.update_program_analysis(sid, analysis),
                FrontendUpdate::UpdateTaskGraph(sid, graph) => frontend.update_task_graph(sid, graph),
                FrontendUpdate::UpdateTaskStatus(sid, task_id, status, error) => {
                    frontend.update_task_status(sid, task_id, status, error)
                }
                FrontendUpdate::DeleteTaskData(sid, data_id) => frontend.delete_task_data(sid, data_id),
                FrontendUpdate::UpdateInputData(sid, data_id, input) => frontend.update_input_data(sid, data_id, input),
                FrontendUpdate::UpdateImportData(sid, data_id) => frontend.update_import_data(sid, data_id),
                FrontendUpdate::UpdateTableData(sid, data_id) => frontend.update_table_data(sid, data_id),
                FrontendUpdate::UpdateVisualizationData(sid, data_id, spec) => {
                    frontend.update_visualization_data(sid, data_id, spec)
                }
            }?;
        }
        frontend.flush_updates(session_id)?;
        Ok(())
    }
    fn update_program(&self, sid: u32, ast: Arc<ProgramContainer>) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateProgram(sid, ast));
        Ok(())
    }
    fn update_program_analysis(&self, sid: u32, analysis: Arc<ProgramInstanceContainer>) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateProgramAnalysis(sid, analysis));
        Ok(())
    }
    fn update_task_graph(&self, sid: u32, graph: Arc<TaskGraph>) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateTaskGraph(sid, graph));
        Ok(())
    }
    fn update_task_status(
        &self,
        sid: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateTaskStatus(sid, task_id, status, error));
        Ok(())
    }
    fn delete_task_data(&self, sid: u32, data_id: u32) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::DeleteTaskData(sid, data_id));
        Ok(())
    }
    fn update_input_data(&self, sid: u32, data_id: u32, input: Arc<InputSpec>) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateInputData(sid, data_id, input));
        Ok(())
    }
    fn update_import_data(&self, sid: u32, data_id: u32) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateImportData(sid, data_id));
        Ok(())
    }
    fn update_table_data(&self, sid: u32, data_id: u32) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateTableData(sid, data_id));
        Ok(())
    }
    fn update_visualization_data(&self, sid: u32, data_id: u32, viz: Arc<VizSpec>) -> Result<(), String> {
        let mut buffer = self.updates.lock().unwrap();
        buffer.push(FrontendUpdate::UpdateVisualizationData(sid, data_id, viz.clone()));
        Ok(())
    }
}

#[derive(Default)]
pub struct WorkflowFrontend {
    buffer: FrontendBuffer,
    session_id: u32,
}

impl WorkflowFrontend {
    pub fn create(session_id: u32, frontend: Arc<dyn Frontend>) -> Self {
        Self {
            buffer: FrontendBuffer::create(frontend),
            session_id,
        }
    }
    pub fn flush_updates_manually(&self) -> Vec<FrontendUpdate> {
        self.buffer.flush_updates_manually()
    }
    pub fn flush_updates(&self) {
        // XXX maybe a frontend hook as well?
        if let Err(e) = self.buffer.flush_updates(self.session_id) {
            console::println(&format!("frontend update failed with error: {}", &e));
        }
    }
    pub fn update_program(&self, ast: Arc<ProgramContainer>) {
        self.buffer.update_program(self.session_id, ast).unwrap()
    }
    pub fn update_program_analysis(&self, analysis: Arc<ProgramInstanceContainer>) {
        self.buffer.update_program_analysis(self.session_id, analysis).unwrap()
    }
    pub fn update_task_graph(&self, graph: Arc<TaskGraph>) {
        self.buffer.update_task_graph(self.session_id, graph).unwrap()
    }
    pub fn update_task_status(&self, task_id: u32, status: TaskStatusCode, error: Option<String>) {
        self.buffer
            .update_task_status(self.session_id, task_id, status, error)
            .unwrap()
    }
    pub fn delete_task_data(&self, data_id: u32) {
        self.buffer.delete_task_data(self.session_id, data_id).unwrap()
    }
    pub fn update_input_data(&self, data_id: u32, input: Arc<InputSpec>) {
        self.buffer.update_input_data(self.session_id, data_id, input).unwrap()
    }
    pub fn update_import_data(&self, data_id: u32) {
        self.buffer.update_import_data(self.session_id, data_id).unwrap()
    }
    pub fn update_table_data(&self, data_id: u32) {
        self.buffer.update_table_data(self.session_id, data_id).unwrap()
    }
    pub fn update_visualization_data(&self, data_id: u32, viz: Arc<VizSpec>) {
        self.buffer
            .update_visualization_data(self.session_id, data_id, viz)
            .unwrap()
    }
}

#[allow(dead_code)]
pub(crate) fn run_task_status_updates(updates: &[FrontendUpdate]) -> Vec<(TaskStatusCode, Option<String>)> {
    let mut max_task_id = 0;
    for update in updates.iter() {
        match &update {
            FrontendUpdate::UpdateTaskStatus(_, task_id, _, _) => max_task_id = max_task_id.max(*task_id),
            _ => (),
        }
    }
    let mut tasks = Vec::new();
    tasks.resize((max_task_id + 1) as usize, (TaskStatusCode::Pending, None));
    for update in updates.iter() {
        match &update {
            FrontendUpdate::UpdateTaskStatus(_, task_id, status, error) => {
                tasks[*task_id as usize] = (status.clone(), error.clone())
            }
            _ => (),
        }
    }
    return tasks;
}
