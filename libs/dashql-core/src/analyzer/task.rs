use std::sync::atomic::{AtomicU8, Ordering};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[repr(u8)]
pub enum TaskStatusCode {
    Pending = 0,
    Skipped = 1,
    Preparing = 2,
    Prepared = 3,
    Executing = 4,
    Blocked = 5,
    Failed = 6,
    Completed = 7,
}

impl Default for TaskStatusCode {
    fn default() -> Self {
        TaskStatusCode::Pending
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskBlocker {
    None,
    Dependency,
    UserInteraction,
    HttpRequest,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskType {
    None,
    CreateAs,
    CreateTable,
    CreateView,
    CreateViz,
    Declare,
    DropBlob,
    DropInput,
    DropTable,
    DropView,
    DropViz,
    Import,
    Load,
    ModifyTable,
    Set,
    Unset,
    UpdateViz,
}

impl Default for TaskType {
    fn default() -> Self {
        TaskType::None
    }
}

#[derive(Debug, Serialize)]
pub struct Task {
    pub task_type: TaskType,
    #[serde(with = "crate::utils::atomic_serde::u8")]
    pub task_status: AtomicU8,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub origin_statement: Option<usize>,
    pub state_id: usize,
}

impl PartialEq for Task {
    fn eq(&self, other: &Self) -> bool {
        self.task_type == other.task_type
            && self.task_status.load(Ordering::SeqCst) == other.task_status.load(Ordering::SeqCst)
            && self.depends_on == other.depends_on
            && self.required_for == other.required_for
            && self.origin_statement == other.origin_statement
            && self.state_id == other.state_id
    }
}

impl Eq for Task {}

impl Clone for Task {
    fn clone(&self) -> Self {
        Self {
            task_type: self.task_type.clone(),
            task_status: AtomicU8::new(self.task_status.load(Ordering::SeqCst)),
            depends_on: self.depends_on.clone(),
            required_for: self.required_for.clone(),
            origin_statement: self.origin_statement.clone(),
            state_id: self.state_id.clone(),
        }
    }
}
