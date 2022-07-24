use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{
    analyzer::{
        analysis_settings::ProgramAnalysisSettings,
        program_instance::{analyze_program, ProgramInstance},
        task::TaskStatusCode,
        task_planner::TaskGraph,
    },
    error::SystemError,
    execution::execution_context::ExecutionContext,
    external::{self, database::open_in_memory, Database, DatabaseConnection, QueryResultBuffer},
    grammar::ProgramContainer,
};

pub type WorkflowSessionId = u32;

pub struct WorkflowAPI<WF>
where
    WF: WorkflowFrontend,
{
    settings: Arc<ProgramAnalysisSettings>,
    runtime: Arc<dyn external::Runtime>,
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
            settings: Arc::new(ProgramAnalysisSettings::default()),
            runtime: external::runtime::create(),
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
            settings: self.settings.clone(),
            runtime: self.runtime.clone(),
            session_id,
            frontend,
            database: self.default_database.clone(),
            database_connection: connection,
            latest_program: None,
            latest_instance: None,
            planned_instance: None,
            planned_graph: None,
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
    fn update_program(self: &Arc<Self>, session_id: u32, text: &str, ast: &ProgramContainer) -> Result<(), String>;
    fn update_program_analysis(self: &Arc<Self>, session_id: u32, analysis: &ProgramInstance) -> Result<(), String>;
    fn update_task_graph(self: &Arc<Self>, session_id: u32, graph: &TaskGraph) -> Result<(), String>;
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

pub struct WorkflowSessionInstance {
    program: Arc<ProgramContainer>,
    instance: Arc<ProgramInstance<'static>>,
}

pub struct WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    settings: Arc<ProgramAnalysisSettings>,
    runtime: Arc<dyn external::Runtime>,
    session_id: WorkflowSessionId,
    pub frontend: Arc<WF>,
    #[allow(dead_code)]
    database: Arc<Mutex<dyn Database>>,
    database_connection: Arc<Mutex<dyn DatabaseConnection>>,
    latest_program: Option<Arc<ProgramContainer>>,
    latest_instance: Option<WorkflowSessionInstance>,
    planned_instance: Option<WorkflowSessionInstance>,
    planned_graph: Option<Arc<TaskGraph>>,
}

impl<WF> WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn update_program(&mut self, text: &str) -> Result<(), SystemError> {
        let program = Arc::new(ProgramContainer::parse(&text).await.map_err(|e| e.to_string())?);
        self.latest_program = Some(program.clone());

        let context = ExecutionContext::create(
            self.settings.clone(),
            self.runtime.clone(),
            self.database.clone(),
            program.get_arena(),
        );
        let input = HashMap::new();
        let instance = analyze_program(context, program.get_text(), program.get_program().clone(), input)
            .map(|instance| Arc::new(instance));

        self.frontend.begin_batch_update(self.session_id)?;
        self.frontend.update_program(self.session_id, text, &program)?;
        if let Ok(instance) = &instance {
            self.latest_instance = Some(WorkflowSessionInstance {
                program: program.clone(),
                instance: unsafe { std::mem::transmute(instance.clone()) },
            });
            self.frontend.update_program_analysis(self.session_id, &instance)?;
        }
        self.frontend.end_batch_update(self.session_id)?;

        instance.map(|_| ())
    }

    pub async fn update_program_input(&mut self, input: &str) -> Result<(), SystemError> {
        // TODO Deserialize input from json
        let new_input = HashMap::new();

        let program = match &self.latest_program {
            Some(program) => program,
            None => return Err(SystemError::Generic("program not known".to_string())),
        };
        let context = ExecutionContext::create(
            self.settings.clone(),
            self.runtime.clone(),
            self.database.clone(),
            program.get_arena(),
        );
        let instance = analyze_program(context, program.get_text(), program.get_program().clone(), new_input)
            .map(|instance| Arc::new(instance))?;

        self.frontend.begin_batch_update(self.session_id)?;
        self.frontend.update_program_analysis(self.session_id, &instance)?;
        self.frontend.end_batch_update(self.session_id)?;
        Ok(())
    }

    pub async fn edit_program(&mut self, edits: &str) -> Result<(), SystemError> {
        Ok(())
    }

    pub async fn run_query(&mut self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        let mut conn = self.database_connection.lock().unwrap();
        conn.run_query(text).await
    }
}
