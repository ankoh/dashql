use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
};

use crate::{
    analyzer::{
        analysis_settings::ProgramAnalysisSettings,
        program_instance::{analyze_program, ProgramInstanceContainer},
        task_graph::TaskGraph,
        task_planner::plan_tasks,
    },
    error::SystemError,
    execution::{execution_context::ExecutionContext, task_scheduler::TaskScheduler},
    external::{self, console, database::open_in_memory, Database, DatabaseConnection, QueryResultBuffer},
    grammar::ProgramContainer,
};

use super::workflow_frontend::{Frontend, WorkflowFrontend};

pub type WorkflowSessionId = u32;

pub struct WorkflowAPI {
    settings: Arc<ProgramAnalysisSettings>,
    runtime: Arc<dyn external::Runtime>,
    default_database: Arc<dyn Database>,
    next_session_id: u32,
    pub sessions: HashMap<WorkflowSessionId, Arc<WorkflowSession>>,
}

impl WorkflowAPI {
    pub async fn new() -> Result<Self, SystemError> {
        let database = open_in_memory().await?;
        Ok(WorkflowAPI {
            settings: Arc::new(ProgramAnalysisSettings::default()),
            runtime: external::runtime::create(),
            default_database: Arc::new(database),
            next_session_id: 1,
            sessions: HashMap::new(),
        })
    }

    pub async fn create_session(&mut self, frontend: Arc<dyn Frontend>) -> Result<WorkflowSessionId, SystemError> {
        let session_id = self.next_session_id;
        self.next_session_id += 1;
        let connection = self.default_database.connect().await?;
        let frontend = Arc::new(WorkflowFrontend::create(session_id, frontend.clone()));
        let session = Arc::new(WorkflowSession {
            _session_id: session_id,
            settings: self.settings.clone(),
            runtime: self.runtime.clone(),
            frontend,
            database: self.default_database.clone(),
            database_connection: connection,
            scheduler_executing: AtomicBool::new(false),
            latest_parsed: Mutex::new(None),
            latest_instance: Mutex::new(None),
            latest_executed: Mutex::new(None),
        });
        self.sessions.insert(session_id, session);
        Ok(session_id)
    }
    #[allow(dead_code)]
    pub fn release_session(&mut self, session_id: WorkflowSessionId) -> Option<Arc<WorkflowSession>> {
        self.sessions.remove(&session_id)
    }
    pub fn get_session(&self, session_id: WorkflowSessionId) -> Option<Arc<WorkflowSession>> {
        self.sessions.get(&session_id).map(|s| s.clone())
    }
}

pub struct WorkflowSession {
    _session_id: WorkflowSessionId,
    settings: Arc<ProgramAnalysisSettings>,
    runtime: Arc<dyn external::Runtime>,
    pub frontend: Arc<WorkflowFrontend>,
    #[allow(dead_code)]
    database: Arc<dyn Database>,
    database_connection: Arc<dyn DatabaseConnection>,
    scheduler_executing: AtomicBool,
    latest_parsed: Mutex<Option<Arc<ProgramContainer>>>,
    latest_instance: Mutex<Option<Arc<ProgramInstanceContainer>>>,
    latest_executed: Mutex<Option<(Arc<ProgramInstanceContainer>, Arc<TaskGraph>)>>,
}

impl WorkflowSession {
    pub async fn execute_program(&self) -> Result<(), SystemError> {
        if self
            .scheduler_executing
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |_| Some(true))
            .unwrap_or(true)
        {
            console::println("ERROR: scheduler locked");
            return Ok(());
        }
        let latest = match self.latest_instance.lock().unwrap().clone() {
            Some(instance) => instance,
            None => {
                console::println("ERROR: no instance");
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };
        let planned = self.latest_executed.lock().unwrap().clone();
        let planned_ref = planned.as_ref().map(|(ic, g)| (&ic.instance, g.as_ref()));

        console::println("PLAN TASKS");
        // Plan the latest program instance
        let plan = Arc::new(match plan_tasks(&latest.instance, planned_ref) {
            Ok(plan) => plan,
            Err(_e) => {
                console::println("ERROR: planning failed");
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        });
        console::println(&format!("{:?}", &plan.tasks));

        // Notify the frontend about the plan
        console::println("UPDATE TASK GRAPH");
        self.frontend.update_task_graph(plan.clone());
        self.frontend.flush_updates();

        // Setup a task scheduler
        console::println("SCHEDULE TASK GRAPH");
        self.latest_executed
            .lock()
            .unwrap()
            .replace((latest.clone(), plan.clone()));
        let mut scheduler = match TaskScheduler::schedule(&latest.instance, &plan) {
            Ok(sched) => sched,
            Err(e) => {
                external::console::println(&format!("{}", &e));
                // TODO: log things
                self.scheduler_executing.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };

        // Perform scheduler work until done
        loop {
            console::println("NEXT SCHEDULER TASKS");
            match scheduler.next(&self.frontend).await {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    external::console::println(&format!("{}", &e));
                    // TODO: log things
                    break;
                }
            }
        }
        console::println("SCHEDULER DONE");
        self.scheduler_executing.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub async fn update_program(&self, text: &str) -> Result<(), SystemError> {
        // Is redundant?
        let redundant = {
            let latest = self.latest_parsed.lock().unwrap();
            match latest.as_ref() {
                Some(container) => container.get_text() == text,
                None => false,
            }
        };
        if redundant {
            return Ok(());
        }

        // Parse the program
        let program = Arc::new(ProgramContainer::parse(&text).await.map_err(|e| e.to_string())?);
        self.latest_parsed.lock().unwrap().replace(program.clone());
        self.frontend.update_program(program.clone());

        // Create an execution context for the instantiation
        let context = ExecutionContext::create(
            self.settings.clone(),
            self.runtime.clone(),
            self.database.clone(),
            self.database_connection.clone(),
            program.get_arena(),
        );
        let input = HashMap::new();
        match analyze_program(context, program.get_text(), program.get_program().clone(), input) {
            Ok(instance) => {
                let instance = Arc::new(instance.wire(program.clone()));
                self.latest_instance.lock().unwrap().replace(instance.clone());
                self.frontend.update_program_analysis(instance.clone());
                Some(instance)
            }
            Err(_e) => None,
        };
        self.frontend.flush_updates();
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn update_program_input(&self, _input: &str) -> Result<(), SystemError> {
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
            self.database_connection.clone(),
            program.get_arena(),
        );
        match analyze_program(context, program.get_text(), program.get_program().clone(), new_input) {
            Ok(instance) => {
                let instance = Arc::new(instance.wire(program.clone()));
                self.latest_instance.lock().unwrap().replace(instance.clone());
                self.frontend.update_program_analysis(instance.clone());
                Some(instance)
            }
            Err(_e) => None,
        };
        self.frontend.flush_updates();
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn edit_program(&self, _edits: &str) -> Result<(), SystemError> {
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn run_query(&self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        self.database_connection.run_query(text).await
    }
}

#[cfg(test)]
mod test {
    use std::error::Error;

    use crate::{
        analyzer::task::{TaskStatusCode, TaskType},
        api::workflow_frontend::FrontendBuffer,
    };

    use super::*;

    #[tokio::test]
    async fn test_hello_workflow() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(FrontendBuffer::default());
        let mut api: WorkflowAPI = WorkflowAPI::new().await?;
        let session_id = api.create_session(frontend.clone()).await?;
        let session = api.get_session(session_id).unwrap();
        session.update_program("SELECT 42").await?;

        let frontend_updates = frontend.flush_updates_manually();
        assert_eq!(frontend_updates.len(), 2, "{:?}", &frontend_updates);
        Ok(())
    }

    #[tokio::test]
    async fn test_skipped() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(FrontendBuffer::default());
        let mut api: WorkflowAPI = WorkflowAPI::new().await?;
        let session_id = api.create_session(frontend).await?;
        let session = api.get_session(session_id).unwrap();

        // Update the program
        session.update_program("create table foo as select 42").await?;
        let latest_parsed = session.latest_parsed.lock().unwrap().clone();
        let latest_instance = session.latest_instance.lock().unwrap().clone();
        assert!(latest_parsed.is_some());
        assert!(latest_instance.is_some());

        // Execute the plan
        session.execute_program().await?;
        let planned_instance = session.latest_executed.lock().unwrap().clone();
        assert!(planned_instance.is_some());
        let (_, graph) = planned_instance.clone().unwrap();
        assert_eq!(graph.tasks.len(), 1);
        assert_eq!(graph.tasks[0].task_type, TaskType::CreateTable);
        assert_eq!(
            graph.tasks[0].task_status.load(Ordering::SeqCst),
            TaskStatusCode::Skipped as u8
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_visualize_table() -> Result<(), Box<dyn Error + Send + Sync>> {
        let frontend = Arc::new(FrontendBuffer::default());
        let mut api: WorkflowAPI = WorkflowAPI::new().await?;
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
        let planned_instance = session.latest_executed.lock().unwrap().clone();
        assert!(planned_instance.is_some());
        let (_, graph) = planned_instance.clone().unwrap();
        assert_eq!(graph.tasks.len(), 2);
        assert_eq!(graph.tasks[0].task_type, TaskType::CreateTable);
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
