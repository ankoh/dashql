use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{
    analyzer::{task::TaskStatusCode, task_planner::TaskGraph},
    grammar::ProgramContainer,
};

pub type WorkflowSessionId = u32;

pub struct WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    next_session_id: u32,
    sessions: HashMap<WorkflowSessionId, Arc<Mutex<WorkflowSession<WF>>>>,
}

impl<WF> Default for WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    fn default() -> Self {
        Self {
            next_session_id: Default::default(),
            sessions: Default::default(),
        }
    }
}

impl<WF> WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    pub fn create_session(&mut self, frontend: Arc<WF>) -> Result<WorkflowSessionId, String> {
        let session_id = self.next_session_id;
        self.next_session_id += 1;
        let session = Arc::new(Mutex::new(WorkflowSession { session_id, frontend }));
        self.sessions.insert(session_id, session);
        Ok(session_id)
    }
    pub fn release_session(&mut self, session_id: WorkflowSessionId) -> Option<Arc<Mutex<WorkflowSession<WF>>>> {
        self.sessions.remove(&session_id)
    }
    pub fn get_session(&self, session_id: WorkflowSessionId) -> Option<Arc<Mutex<WorkflowSession<WF>>>> {
        self.sessions.get(&session_id).map(|s| s.clone())
    }
}

pub trait WorkflowFrontend {
    fn begin_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String>;
    fn end_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String>;
    fn update_program(self: &Arc<Self>, session_id: u32, program: &Arc<ProgramContainer>) -> Result<(), String>;
    fn update_task_graph(self: &Arc<Self>, session_id: u32, graph: &Arc<TaskGraph>) -> Result<(), String>;
    fn update_task_status(
        self: &Arc<Self>,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String>;
    fn delete_task_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_input_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_import_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_table_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_visualization_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String>;
}

pub struct WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    session_id: WorkflowSessionId,
    pub frontend: Arc<WF>,
}

impl<WF> WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn update_program(&mut self, text: &str) -> Result<(), String> {
        let program = Arc::new(ProgramContainer::parse(&text).await.map_err(|e| e.to_string())?);
        // XXX plan the workflow

        self.frontend.begin_batch_update(self.session_id)?;
        self.frontend.update_program(self.session_id, &program)?;
        self.frontend.end_batch_update(self.session_id)?;
        Ok(())
    }
}
