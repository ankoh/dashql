use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub enum TaskClass {
    SetupTask,
    ProgramTask,
}

#[derive(Debug, Clone, Serialize)]
pub enum TaskStatusCode {
    Pending,
    Skipped,
    Running,
    Blocked,
    Failed,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
pub enum TaskBlocker {
    None,
    Dependency,
    UserInteraction,
    HttpRequest,
}

#[derive(Debug, Clone, Serialize)]
pub enum SetupTaskType {
    None,
    DropBlob,
    DropInput,
    DropSet,
    DropTable,
    DropView,
    DropViz,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetupTask {
    pub task_type: SetupTaskType,
    pub task_status_code: TaskStatusCode,
    pub depends_on: Vec<u32>,
    pub required_for: Vec<u32>,
    pub object_id: u32,
    pub name_qualified: u32,
}

#[derive(Debug, Clone, Serialize)]
pub enum ProgramTaskType {
    None,
    CreateTable,
    CreateView,
    CreateViz,
    Fetch,
    Input,
    Load,
    ModifyTable,
    Set,
    Transform,
    UpdateViz,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgramTask {
    pub task_type: ProgramTaskType,
    pub task_status_code: TaskStatusCode,
    pub depends_on: Vec<u32>,
    pub required_for: Vec<u32>,
    pub origin_statement: u32,
    pub object_id: u32,
    pub name_qualified: Option<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskGraph {
    pub next_object_id: u32,
    pub setup_tasks: Vec<SetupTask>,
    pub program_tasks: Vec<ProgramTask>,
}

pub struct TaskPlanner {}
