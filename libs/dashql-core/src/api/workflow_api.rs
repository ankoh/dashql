use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{analyzer::task_planner::TaskGraph, grammar::ProgramContainer};

pub type WorkflowSessionId = u32;

#[derive(Default)]
pub struct WorkflowAPI {
    next_session_id: u32,
    sessions: HashMap<WorkflowSessionId, Arc<Mutex<WorkflowSession>>>,
}

impl WorkflowAPI {
    pub fn create_session(&mut self, frontend: Box<dyn WorkflowFrontend>) -> Result<WorkflowSessionId, String> {
        let session_id = self.next_session_id;
        self.next_session_id += 1;
        let session = Arc::new(Mutex::new(WorkflowSession { session_id, frontend }));
        self.sessions.insert(session_id, session);
        Ok(session_id)
    }
    pub fn close_session(&mut self, session_id: WorkflowSessionId) -> Result<(), String> {
        self.sessions.remove(&session_id);
        Ok(())
    }
    pub fn get_session(&self, session_id: WorkflowSessionId) -> Option<Arc<Mutex<WorkflowSession>>> {
        self.sessions.get(&session_id).map(|s| s.clone())
    }
}

pub trait WorkflowFrontend {
    fn begin_batch_update(&mut self, session_id: u32) -> Result<(), String>;
    fn end_batch_update(&mut self, session_id: u32) -> Result<(), String>;
    fn update_program(&mut self, session_id: u32, program: &Arc<ProgramContainer>) -> Result<(), String>;
    fn update_task_graph(&mut self, session_id: u32, graph: &Arc<TaskGraph>) -> Result<(), String>;
    fn update_task_status(
        &self,
        session_id: u32,
        task_class: u32,
        task_id: u32,
        status: u32,
        error: Option<String>,
    ) -> Result<(), String>;
    fn delete_task_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_input_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_import_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_table_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String>;
    fn update_visualization_state(&mut self, session_id: u32, state_id: u32) -> Result<(), String>;
}

pub struct WorkflowSession {
    session_id: WorkflowSessionId,
    frontend: Box<dyn WorkflowFrontend>,
}

impl WorkflowSession {
    pub fn update_program(&mut self, text: &str) -> Result<(), String> {
        let program = Arc::new(ProgramContainer::parse(&text).map_err(|e| e.to_string())?);
        // XXX plan the workflow

        let frontend = self.frontend.as_mut();
        frontend.begin_batch_update(self.session_id)?;
        frontend.update_program(self.session_id, &program)?;
        frontend.end_batch_update(self.session_id)?;
        Ok(())
    }
}
