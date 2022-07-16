use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{
    analyzer::{task::TaskStatusCode, task_planner::TaskGraph},
    error::SystemError,
    external::{database::open_in_memory, Database, DatabaseConnection, QueryResultBuffer},
    grammar::ProgramContainer,
};

pub type WorkflowSessionId = u32;

pub struct WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    default_database: Arc<Mutex<dyn Database>>,
    next_session_id: u32,
    pub sessions: HashMap<WorkflowSessionId, Arc<Mutex<WorkflowSession<WF>>>>,
}

impl<WF> WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn new() -> Result<Self, SystemError> {
        let database = open_in_memory().await?;
        Ok(WorkflowAPI {
            default_database: Arc::new(Mutex::new(database)),
            next_session_id: 1,
            sessions: HashMap::new(),
        })
    }

    pub async fn create_session(&mut self, frontend: Arc<WF>) -> Result<WorkflowSessionId, SystemError> {
        let session_id = self.next_session_id;
        self.next_session_id += 1;
        let connection = self.default_database.lock().unwrap().connect().await?;
        let session = Arc::new(Mutex::new(WorkflowSession {
            session_id,
            frontend,
            database: self.default_database.clone(),
            default_connection: connection,
        }));
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
    fn update_program_text(self: &Arc<Self>, session_id: u32, program_text: &str) -> Result<(), String>;
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
    #[allow(dead_code)]
    database: Arc<Mutex<dyn Database>>,
    default_connection: Arc<Mutex<dyn DatabaseConnection>>,
}

impl<WF> WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn update_program(&mut self, text: &str) -> Result<(), SystemError> {
        let program = Arc::new(ProgramContainer::parse(&text).await.map_err(|e| e.to_string())?);
        // XXX plan the workflow

        self.frontend.begin_batch_update(self.session_id)?;
        self.frontend.update_program(self.session_id, &program)?;
        self.frontend.end_batch_update(self.session_id)?;
        Ok(())
    }

    pub async fn run_query(&mut self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        let mut conn = self.default_connection.lock().unwrap();
        conn.run_query(text).await
    }
}
