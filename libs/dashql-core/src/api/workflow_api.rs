use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
};

use crate::{
    analyzer::{
        analysis_settings::ProgramAnalysisSettings,
        program_instance::{analyze_program, ProgramInstance},
        task::TaskStatusCode,
        task_planner::{plan_tasks, TaskGraph},
    },
    error::SystemError,
    execution::{
        execution_context::ExecutionContext, task_scheduler::TaskScheduler, task_scheduler_log::TaskSchedulerLog,
    },
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
    planned_instance: Option<(WorkflowSessionInstance, Arc<TaskGraph>)>,
}

lazy_static::lazy_static! {
    pub static ref SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);
}

impl<WF> WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn execute_program(&mut self) -> Result<(), SystemError> {
        if SCHEDULER_RUNNING
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |_| Some(true))
            .unwrap_or(true)
        {
            return Ok(());
        }
        let latest = self.latest_instance.as_ref().unwrap();
        let planned = self
            .planned_instance
            .as_ref()
            .map(|(i, tasks)| (i.instance.clone(), tasks.clone()));
        let plan = Arc::new(match plan_tasks(latest.instance.clone(), planned) {
            Ok(plan) => plan,
            Err(_e) => {
                // TODO: log things
                SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
                return Ok(());
            }
        });
        let mut scheduler = match TaskScheduler::schedule(latest.instance.clone(), plan.clone()) {
            Ok(sched) => sched,
            Err(_e) => {
                // TODO: log things
                SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };
        let mut scheduler_log = TaskSchedulerLog::create();
        loop {
            match scheduler.next(&mut scheduler_log).await {
                Ok(true) => {}
                Ok(false) => break,
                Err(_e) => {
                    // TODO: log things
                    break;
                }
            }
        }
        SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
        Ok(())
    }

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
        Ok(())
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
        self.latest_instance = Some(WorkflowSessionInstance {
            program: program.clone(),
            instance: unsafe { std::mem::transmute(instance.clone()) },
        });

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

#[cfg(test)]
mod test {
    use std::{cell::RefCell, error::Error};

    use super::*;

    enum StubWorkflowFrontendCall {
        BeginBatchUpdate(u32),
        EndBatchUpdate(u32),
        UpdateProgram(u32, String, ProgramContainer),
        UpdateProgramAnalysis(u32),
        UpdateTaskGraph(u32, TaskGraph),
        UpdateTaskStatus(u32, u32, TaskStatusCode, Option<String>),
        DeleteTaskState(u32, u32),
        UpdateInputState(u32, u32),
        UpdateImportState(u32, u32),
        UpdateTableState(u32, u32),
        UpdateVisualizationState(u32, u32),
    }

    #[derive(Default)]
    struct StubWorkflowFrontend {
        calls: RefCell<Vec<StubWorkflowFrontendCall>>,
    }

    impl WorkflowFrontend for StubWorkflowFrontend {
        fn begin_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::BeginBatchUpdate(session_id));
            Ok(())
        }
        fn end_batch_update(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::EndBatchUpdate(session_id));
            Ok(())
        }
        fn update_program(self: &Arc<Self>, session_id: u32, text: &str, ast: &ProgramContainer) -> Result<(), String> {
            self.calls.borrow_mut().push(StubWorkflowFrontendCall::UpdateProgram(
                session_id,
                text.to_string(),
                ast.clone(),
            ));
            Ok(())
        }
        fn update_program_analysis(
            self: &Arc<Self>,
            session_id: u32,
            _analysis: &ProgramInstance,
        ) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateProgramAnalysis(session_id));
            Ok(())
        }
        fn update_task_graph(self: &Arc<Self>, session_id: u32, graph: &TaskGraph) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateTaskGraph(session_id, graph.clone()));
            Ok(())
        }
        fn update_task_status(
            self: &Arc<Self>,
            session_id: u32,
            task_id: u32,
            status: TaskStatusCode,
            error: Option<String>,
        ) -> Result<(), String> {
            self.calls.borrow_mut().push(StubWorkflowFrontendCall::UpdateTaskStatus(
                session_id, task_id, status, error,
            ));
            Ok(())
        }
        fn delete_task_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::DeleteTaskState(session_id, state_id));
            Ok(())
        }
        fn update_input_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateInputState(session_id, state_id));
            Ok(())
        }
        fn update_import_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateImportState(session_id, state_id));
            Ok(())
        }
        fn update_table_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateTableState(session_id, state_id));
            Ok(())
        }
        fn update_visualization_state(self: &Arc<Self>, session_id: u32, state_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::UpdateVisualizationState(session_id, state_id));
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_hello_workflow() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(StubWorkflowFrontend::default());
        let mut api: WorkflowAPI<StubWorkflowFrontend> = WorkflowAPI::new().await?;
        let session_id = api.create_session(frontend.clone()).await?;
        let session = api.get_session(session_id).unwrap();
        let mut locked_session = session.try_lock().unwrap();
        locked_session.update_program("SELECT 42").await?;

        let frontend_calls = frontend.calls.borrow();
        assert_eq!(frontend_calls.len(), 4);
        Ok(())
    }
}
