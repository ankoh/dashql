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
        execution_context::ExecutionContext, task_scheduler::TaskScheduler,
        task_scheduler_log::FrontendTaskSchedulerLog,
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
    pub sessions: HashMap<WorkflowSessionId, Arc<WorkflowSession<WF>>>,
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
        let session = Arc::new(WorkflowSession {
            settings: self.settings.clone(),
            runtime: self.runtime.clone(),
            session_id,
            frontend,
            database: self.default_database.clone(),
            database_connection: connection,
            scheduler_executing: AtomicBool::new(false),
            latest_parsed: Mutex::new(None),
            latest_instance: Mutex::new(None),
            planned_instance: Mutex::new(None),
        });
        self.sessions.insert(session_id, session);
        Ok(session_id)
    }
    pub fn release_session(&mut self, session_id: WorkflowSessionId) -> Option<Arc<WorkflowSession<WF>>> {
        self.sessions.remove(&session_id)
    }
    pub fn get_session(&self, session_id: WorkflowSessionId) -> Option<Arc<WorkflowSession<WF>>> {
        self.sessions.get(&session_id).map(|s| s.clone())
    }
}

pub trait WorkflowFrontend {
    fn flush_updates(self: &Arc<Self>, session_id: u32) -> Result<(), String>;
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

#[derive(Clone)]
pub struct ProgramInstanceContainer {
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
    scheduler_executing: AtomicBool,
    latest_parsed: Mutex<Option<Arc<ProgramContainer>>>,
    latest_instance: Mutex<Option<ProgramInstanceContainer>>,
    planned_instance: Mutex<Option<(ProgramInstanceContainer, Arc<TaskGraph>)>>,
}

impl<WF> WorkflowSession<WF>
where
    WF: WorkflowFrontend,
{
    pub async fn execute_program(&self) -> Result<(), SystemError> {
        if self
            .scheduler_executing
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |_| Some(true))
            .unwrap_or(true)
        {
            return Ok(());
        }
        let latest = match self.latest_instance.lock().unwrap().clone() {
            Some(instance) => instance,
            None => {
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };
        let planned = self
            .planned_instance
            .lock()
            .unwrap()
            .as_ref()
            .map(|(instance, graph)| (instance.instance.clone(), graph.clone()));

        // Plan the latest program instance
        let plan = Arc::new(match plan_tasks(latest.instance.clone(), planned) {
            Ok(plan) => plan,
            Err(_e) => {
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        });

        // Notify the frontend about the plan
        self.frontend.update_task_graph(self.session_id, &plan)?;
        self.frontend.flush_updates(self.session_id)?;

        // Setup a task scheduler
        self.planned_instance
            .lock()
            .unwrap()
            .replace((latest.clone(), plan.clone()));
        let mut scheduler = match TaskScheduler::schedule(latest.instance.clone(), plan.clone()) {
            Ok(sched) => sched,
            Err(e) => {
                external::console::println(&format!("{}", &e));
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };

        // Perform scheduler work until done
        let mut scheduler_log = FrontendTaskSchedulerLog::create(self.session_id, self.frontend.clone());
        loop {
            external::console::println(&format!("{:?}", &plan.tasks));
            match scheduler.next(&mut scheduler_log).await {
                Ok(true) => {}
                Ok(false) => break,
                Err(_e) => {
                    // TODO: log things
                    break;
                }
            }
        }
        external::console::println("execution done");
        self.scheduler_executing.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub async fn update_program(&self, text: &str) -> Result<(), SystemError> {
        let program = Arc::new(ProgramContainer::parse(&text).await.map_err(|e| e.to_string())?);
        self.latest_parsed.lock().unwrap().replace(program.clone());

        let context = ExecutionContext::create(
            self.settings.clone(),
            self.runtime.clone(),
            self.database.clone(),
            program.get_arena(),
        );
        let input = HashMap::new();
        let instance = match analyze_program(context, program.get_text(), program.get_program().clone(), input)
            .map(|instance| Arc::new(instance))
        {
            Ok(instance) => {
                self.latest_instance.lock().unwrap().replace(ProgramInstanceContainer {
                    program: program.clone(),
                    instance: unsafe { std::mem::transmute(instance.clone()) },
                });
                Some(instance)
            }
            Err(e) => None,
        };

        self.frontend.update_program(self.session_id, text, &program)?;
        if let Some(instance) = &instance {
            self.frontend.update_program_analysis(self.session_id, &instance)?;
        }
        self.frontend.flush_updates(self.session_id)?;
        Ok(())
    }

    pub async fn update_program_input(&self, input: &str) -> Result<(), SystemError> {
        // TODO Deserialize input from json
        let new_input = HashMap::new();

        let program = match self.latest_parsed.lock().unwrap().clone() {
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
        self.latest_instance.lock().unwrap().replace(ProgramInstanceContainer {
            program: program.clone(),
            instance: unsafe { std::mem::transmute(instance.clone()) },
        });

        self.frontend.update_program_analysis(self.session_id, &instance)?;
        self.frontend.flush_updates(self.session_id)?;
        Ok(())
    }

    pub async fn edit_program(&self, edits: &str) -> Result<(), SystemError> {
        Ok(())
    }

    pub async fn run_query(&self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        let mut conn = self.database_connection.lock().unwrap();
        conn.run_query(text).await
    }
}

#[cfg(test)]
mod test {
    use std::{cell::RefCell, error::Error};

    use crate::analyzer::task::TaskType;

    use super::*;

    enum StubWorkflowFrontendCall {
        FlushUpdates(u32),
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
        fn flush_updates(self: &Arc<Self>, session_id: u32) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(StubWorkflowFrontendCall::FlushUpdates(session_id));
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
        session.update_program("SELECT 42").await?;

        let frontend_calls = frontend.calls.borrow();
        assert_eq!(frontend_calls.len(), 3);
        Ok(())
    }

    #[tokio::test]
    async fn test_skipped() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(StubWorkflowFrontend::default());
        let mut api: WorkflowAPI<StubWorkflowFrontend> = WorkflowAPI::new().await?;
        let session_id = api.create_session(frontend.clone()).await?;
        let session = api.get_session(session_id).unwrap();

        // Update the program
        session.update_program("create table foo as select 42").await?;
        let latest_parsed = session.latest_parsed.lock().unwrap().clone();
        let latest_instance = session.latest_instance.lock().unwrap().clone();
        assert!(latest_parsed.is_some());
        assert!(latest_instance.is_some());

        // Execute the plan
        session.execute_program().await?;
        let planned_instance = session.planned_instance.lock().unwrap().clone();
        assert!(planned_instance.is_some());
        let (_, graph) = planned_instance.clone().unwrap();
        assert_eq!(graph.tasks.len(), 1);
        assert_eq!(graph.tasks[0].task_type, TaskType::CreateAs);
        assert_eq!(
            graph.tasks[0].task_status.load(Ordering::SeqCst),
            TaskStatusCode::Skipped as u8
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_visualize_table() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(StubWorkflowFrontend::default());
        let mut api: WorkflowAPI<StubWorkflowFrontend> = WorkflowAPI::new().await?;
        let session_id = api.create_session(frontend.clone()).await?;
        let session = api.get_session(session_id).unwrap();

        // Update the program
        session
            .update_program(
                r#"
            create table foo as select 42;
            visualize foo using table;
        "#,
            )
            .await?;
        let latest_parsed = session.latest_parsed.lock().unwrap().clone();
        let latest_instance = session.latest_instance.lock().unwrap().clone();
        assert!(latest_parsed.is_some());
        assert!(latest_instance.is_some());

        // Execute the plan
        session.execute_program().await?;
        let planned_instance = session.planned_instance.lock().unwrap().clone();
        assert!(planned_instance.is_some());
        let (_, graph) = planned_instance.clone().unwrap();
        assert_eq!(graph.tasks.len(), 2);
        assert_eq!(graph.tasks[0].task_type, TaskType::CreateAs);
        assert_eq!(graph.tasks[1].task_type, TaskType::CreateViz);
        assert_eq!(
            graph.tasks[0].task_status.load(Ordering::SeqCst),
            TaskStatusCode::Completed as u8
        );
        assert_eq!(
            graph.tasks[1].task_status.load(Ordering::SeqCst),
            TaskStatusCode::Completed as u8
        );
        Ok(())
    }
}
